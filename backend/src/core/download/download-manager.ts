import crypto from "node:crypto";
import path from "node:path";
import { EventEmitter } from "node:events";
import { AppConfig } from "../../config/env.js";
import { Logger } from "../../config/logger.js";
import { SandboxViolationError } from "../../errors/index.js";
import { CancellationToken } from "../../utils/concurrency.js";
import { HttpClient } from "../../infrastructure/http/http-client.js";
import { DownloadTask, DownloadInterruptedError } from "./download-task.js";
import { DownloadRequest, DownloadTaskSnapshot } from "./types.js";

export type TaskOutcome =
  | { status: "completed"; snapshot: DownloadTaskSnapshot }
  | { status: "failed" | "cancelled" | "paused"; snapshot: DownloadTaskSnapshot };

export interface ManagerStats {
  queued: number;
  active: number;
  aggregateSpeedBps: number;
  completedTotal: number;
  failedTotal: number;
}

export interface BatchResult {
  completed: number;
  failed: number;
  cancelled: number;
  /** Tasks the user paused (awaiting resume) — not terminal, not a failure. */
  paused: number;
  failures: Array<{ dest: string; error: string }>;
}

/**
 * Central download scheduler:
 *   DownloadManager -> DownloadTask -> HttpClient.openStream -> SHA1 validator
 *
 * Bounded concurrency, per-task pause/resume/cancel, mirror fallback,
 * SHA1+size verification, throttled progress events, offline-friendly reuse.
 */
export class DownloadManager {
  readonly events = new EventEmitter();

  private readonly tasks = new Map<string, DownloadTask>();
  private readonly deferreds = new Map<string, { d: DeferredLike<TaskOutcome>; task: DownloadTask }>();
  private readonly byDest = new Map<string, string>();
  private readonly queue: DownloadTask[] = [];
  private readonly active = new Set<string>();
  private readonly shutdownToken = new CancellationToken();

  private stopped = false;
  private completedTotal = 0;
  private failedTotal = 0;

  constructor(
    private readonly config: AppConfig,
    http: HttpClient,
    private readonly logger: Logger,
  ) {
    void http;
  }

  /**
   * Enqueues a download. Deduplicates by destination path while a task for the
   * same file is still in flight or already finished successfully.
   */
  enqueue(request: DownloadRequest): { taskId: string; outcome: Promise<TaskOutcome> } {
    this.validateRequest(request);

    const existingId = this.byDest.get(request.dest);
    if (existingId !== undefined) {
      const existingTask = this.tasks.get(existingId);
      if (existingTask) {
        if (["pending", "downloading", "paused"].includes(existingTask.status)) {
          const existing = this.deferreds.get(existingId);
          if (existing) return { taskId: existingId, outcome: existing.d.promise };
        }
        if (existingTask.status === "completed") {
          const existing = this.deferreds.get(existingId);
          if (existing) return { taskId: existingId, outcome: existing.d.promise };
        }
      }
    }

    const id = crypto.randomUUID();
    const task = new DownloadTask(id, request, {
      http: new HttpClient(this.config),
      config: this.config,
      logger: this.logger.child({ module: "download-task", taskId: id }),
    });
    this.tasks.set(id, task);
    this.byDest.set(request.dest, id);

    const deferred = createDeferred<TaskOutcome>();
    this.deferreds.set(id, { d: deferred, task });
    this.queue.push(task);

    this.events.emit("task-added", task.snapshot());
    this.schedule();
    return { taskId: id, outcome: deferred.promise };
  }

  enqueueAll(requests: DownloadRequest[]): Promise<BatchResult> {
    return summarize(requests.map((r) => this.enqueue(r).outcome));
  }

  /** Resolves when no work is queued or active. */
  async waitIdle(): Promise<void> {
    if (this.idle()) return;
    return new Promise((resolve) => {
      const listener = (): void => {
        if (this.idle()) {
          this.events.removeListener("state", listener);
          resolve();
        }
      };
      this.events.on("state", listener);
    });
  }

  list(): DownloadTaskSnapshot[] {
    return [...this.tasks.values()].map((t) => t.snapshot());
  }

  get(taskId: string): DownloadTaskSnapshot | undefined {
    return this.tasks.get(taskId)?.snapshot();
  }

  stats(): ManagerStats {
    let speed = 0;
    for (const id of this.active) {
      speed += this.tasks.get(id)?.speedBps() ?? 0;
    }
    return {
      queued: this.queue.filter((t) => t.status === "pending").length,
      active: this.active.size,
      aggregateSpeedBps: Math.round(speed),
      completedTotal: this.completedTotal,
      failedTotal: this.failedTotal,
    };
  }

  /** Dynamically update the max concurrent downloads. Triggers scheduling. */
  setConcurrency(n: number): void {
    // Mirror the startup EnvSchema bound (min 1 / max 64): 0 would deadlock the
    // scheduler (active.size < 0 is never true) and huge values could saturate
    // bandwidth / file handles.
    const clamped = Math.min(64, Math.max(1, Math.floor(n)));
    if (clamped !== n) {
      this.logger.warn(
        { requested: n, clamped },
        "download concurrency clamped to allowed range [1, 64]",
      );
    }
    this.config.env.DOWNLOAD_CONCURRENCY = clamped;
    this.schedule();
  }

  /** Pauses an active or queued task (keeps .part data for resuming). */
  pause(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || !["pending", "downloading"].includes(task.status)) return false;

    if (this.active.has(taskId)) {
      task.requestPause();
      return true;
    }
    // Queued: hold it in place; the scheduler skips held tasks.
    task.hold();
    this.events.emit("task-paused", task.snapshot());
    return true;
  }

  resume(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "paused" || this.stopped) return false;
    task.prepareResume();
    this.events.emit("task-added", task.snapshot());
    this.schedule();
    return true;
  }

  cancel(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || ["completed", "failed", "cancelled"].includes(task.status)) return false;

    if (this.active.has(taskId)) {
      task.requestCancel();
      return true;
    }
    // Still queued: settle immediately.
    this.removeFromQueue(task);
    task.requestCancel();
    const entry = this.deferreds.get(taskId);
    if (entry) {
      entry.d.resolve({ status: "cancelled", snapshot: task.snapshot() });
      this.settleCleanup(task);
    }
    this.events.emit("task-cancelled", task.snapshot());
    this.events.emit("state");
    return true;
  }

  cancelAll(): void {
    for (const t of [...this.queue]) this.cancel(t.id);
    for (const id of [...this.active]) this.cancel(id);
  }

  shutdown(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.cancelAll();
    this.shutdownToken.cancel();
  }

  private idle(): boolean {
    return this.active.size === 0 && !this.queue.some((t) => t.status === "pending");
  }

  private schedule(): void {
    while (!this.stopped && this.active.size < this.config.env.DOWNLOAD_CONCURRENCY) {
      const idx = this.queue.findIndex((t) => t.status === "pending");
      if (idx === -1) break;
      const [task] = this.queue.splice(idx, 1);
      if (!task) break;
      this.active.add(task.id);
      void this.executeNow(task);
    }
    this.events.emit("state");
  }

  private async executeNow(task: DownloadTask): Promise<void> {
    try {
      await task.run(this.events);
      this.completedTotal += 1;
      const snapshot = task.snapshot();
      this.events.emit("task-completed", snapshot);
      this.resolveDeferred(task, { status: "completed", snapshot });
    } catch (err) {
      if (err instanceof DownloadInterruptedError) {
        if (err.reason === "paused") {
          this.logger.debug({ taskId: task.id }, "download paused");
          this.events.emit("task-paused", task.snapshot());
          this.resolveDeferred(task, { status: "paused", snapshot: task.snapshot() });
        } else {
          this.events.emit("task-cancelled", task.snapshot());
          this.resolveDeferred(task, { status: "cancelled", snapshot: task.snapshot() });
        }
      } else {
        this.failedTotal += 1;
        this.logger.warn({ err, taskId: task.id, dest: task.request.dest }, "download failed");
        const snapshot = task.snapshot();
        this.events.emit("task-failed", snapshot);
        this.resolveDeferred(task, { status: "failed", snapshot });
      }
    } finally {
      this.active.delete(task.id);
      this.settleCleanup(task);
      setImmediate(() => this.schedule());
    }
  }

  private removeFromQueue(task: DownloadTask): void {
    const idx = this.queue.indexOf(task);
    if (idx >= 0) this.queue.splice(idx, 1);
  }

  private resolveDeferred(task: DownloadTask, outcome: TaskOutcome): void {
    const entry = this.deferreds.get(task.id);
    if (entry) entry.d.resolve(outcome);
  }

  /**
   * Cleans up scheduler bookkeeping once a task reaches a terminal state.
   *
   * Completed tasks keep their destination → task mapping (and resolved
   * deferred) for a short retention window so `enqueue()` can deduplicate
   * against the same destination, then the whole record is pruned.
   *
   * Failed / cancelled tasks drop their dedup mapping immediately and are
   * pruned from the task map after the same retention window (list()/get() stay
   * useful briefly). Paused tasks remain in the task map until resumed or
   * cancelled so `resume()` keeps working.
   */
  private settleCleanup(task: DownloadTask): void {
    if (task.status === "completed") {
      const prune = (): void => {
        this.tasks.delete(task.id);
        const destKey = [...this.byDest.entries()].find(([, id]) => id === task.id)?.[0];
        if (destKey) this.byDest.delete(destKey);
        this.deferreds.delete(task.id);
      };
      setTimeout(prune, 60_000).unref?.();
      return;
    }

    const destKey = [...this.byDest.entries()].find(([, id]) => id === task.id)?.[0];
    if (destKey) this.byDest.delete(destKey);
    this.deferreds.delete(task.id);

    if (["failed", "cancelled"].includes(task.status)) {
      // keep record briefly for API visibility; prune on next GC cycle
      setTimeout(() => {
        if (["failed", "cancelled"].includes(this.tasks.get(task.id)?.status ?? "")) {
          this.tasks.delete(task.id);
        }
      }, 60_000).unref?.();
    }
  }

  private validateRequest(req: DownloadRequest): void {
    // The destination may live under any single writable root (shared game
    // stores live under dataDir, per-instance files under instancesDir, and
    // misc downloads under downloadsDir) — not all three at once.
    const dest = path.resolve(req.dest);
    // Shared game stores may live on ASCII override paths (VERSIONS_DIR /
    // LIBRARIES_DIR / ASSETS_DIR) outside dataDir — those are writable roots too.
    const withinRoot = [
      this.config.dataDir,
      this.config.instancesDir,
      this.config.downloadsDir,
      this.config.versionsDir,
      this.config.librariesDir,
      this.config.assetsDir,
    ].some(
      (base) => {
        const resolvedBase = path.resolve(base);
        return dest === resolvedBase || dest.startsWith(resolvedBase + path.sep);
      },
    );
    if (!withinRoot) throw new SandboxViolationError(req.dest);
    if (req.urls.length === 0) throw new Error(`No URLs provided for ${req.dest}`);
    for (const url of req.urls) {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new Error(`Unsupported protocol in ${url}`);
      }
    }
  }
}

export function summarize(promises: Promise<TaskOutcome>[]): Promise<BatchResult> {
  return Promise.all(promises).then((results) => {
    const batch: BatchResult = { completed: 0, failed: 0, cancelled: 0, paused: 0, failures: [] };
    for (const r of results) {
      if (r.status === "completed") batch.completed += 1;
      else if (r.status === "failed") {
        batch.failed += 1;
        batch.failures.push({ dest: r.snapshot.dest, error: r.snapshot.error ?? "unknown" });
      } else if (r.status === "paused") {
        // Pause is NOT a terminal state: the task is suspended awaiting resume.
        // Count it separately so callers can hold an install instead of treating
        // the batch as silently cancelled. (#UX-1)
        batch.paused += 1;
      } else batch.cancelled += 1;
    }
    return batch;
  });
}

interface DeferredLike<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): DeferredLike<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
