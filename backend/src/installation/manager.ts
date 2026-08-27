import fs from "node:fs";
import path from "node:path";
import { AppConfig } from "../config/env.js";
import { Logger } from "../config/logger.js";
import { EventBus, Events } from "../websocket/events.js";
import { DownloadManager } from "../core/download/download-manager.js";
import { VersionService } from "../services/version-service.js";
import { DownloadService } from "../services/download-service.js";
import { AssetService } from "../core/assets/asset-service.js";
import { InstanceService } from "../services/instance-service.js";
import { LoaderRegistry } from "../core/loaders/loader-registry.js";
import { AutoDependencyService } from "../core/content/auto-dependency.js";
import { LibraryResolver } from "../core/libraries/library-resolver.js";
import { currentRuntime } from "../utils/runtime-env.js";
import { AppError, IntegrityVerificationError } from "../errors/index.js";
import { InstallationPlanBuilder, resolveInstallVersionId } from "./plan.js";
import { InstallationPlan } from "./types.js";
import {
  InstallPhase,
  InstallControl,
  InstanceStatus,
  transition,
  instanceStatusForPhase,
} from "./state.js";

/** Live snapshot pushed to the front-end (design doc §35–§37). */
export interface InstallationSnapshot {
  instanceId: string;
  phase: InstallPhase;
  instanceStatus: InstanceStatus;
  progressPct: number;
  downloadedBytes: number;
  totalBytes: number;
  speedBps: number;
  etaSec: number | null;
  tasksDone: number;
  tasksTotal: number;
  error?: string;
  /** human-readable current sub-stage (e.g. loader build), so "stuck" isn't misread as dead */
  message?: string;
  updatedAt: number;
}

interface Session {
  instanceId: string;
  phase: InstallPhase;
  control: InstallControl;
  /** destination path -> expected bytes for files this install still needs */
  pending: Map<string, number>;
  completedBytes: number;
  plan?: InstallationPlan;
  /** latest human-readable sub-stage description for the live snapshot */
  stage?: string;
  /** heartbeat used to keep the UI "alive" during phases with no byte progress */
  heartbeat?: ReturnType<typeof setInterval>;
  trackerOff: () => void;
}

const PROGRESS_FLUSH_MS = 250;
const FORGE_PATCH_MARKER = ".forge_patched_minecraft";
const BINARY_PATCH_LOADERS = new Set(["forge", "neoforge"]);
const TERMINAL_PHASES: ReadonlySet<InstallPhase> = new Set(["READY", "FAILED", "CANCELLED"]);

/**
 * Per-instance install orchestrator built on the state machine (§3). Reuses the
 * existing idempotent provisioning/download/loader pipeline while wrapping it in
 * explicit phases, progress events and pause/resume/cancel control.
 */
export class InstallationManager {
  private readonly sessions = new Map<string, Session>();
  private readonly plans: InstallationPlanBuilder;

  constructor(
    private readonly config: AppConfig,
    private readonly versions: VersionService,
    private readonly downloads: DownloadService,
    private readonly assets: AssetService,
    private readonly loaders: LoaderRegistry,
    private readonly instances: InstanceService,
    private readonly autoDeps: AutoDependencyService,
    private readonly downloadManager: DownloadManager,
    private readonly bus: EventBus,
    private readonly logger: Logger,
  ) {
    this.plans = new InstallationPlanBuilder(
      config,
      versions,
      downloads,
      assets,
      loaders,
      logger.child({ module: "install-plan" }),
    );
  }

  /** Whether the given instance has a live (non-terminal, non-paused) install. */
  isInstalling(instanceId: string): boolean {
    const s = this.sessions.get(instanceId);
    return s !== undefined && !["READY", "FAILED", "CANCELLED", "PAUSED"].includes(s.phase);
  }

  snapshot(instanceId: string): InstallationSnapshot | null {
    const s = this.sessions.get(instanceId);
    if (!s) return null;
    return this.toSnapshot(instanceId, s);
  }

  /** Builds a plan for a potential install (no bytes are fetched). */
  plan(instance: {
    id: string;
    minecraftVersion: string;
    loader: string;
    loaderVersion: string | null;
  }): Promise<InstallationPlan> {
    return this.plans.build(instance);
  }

  /**
   * Starts a background install for an instance. Optionally accepts a plan that
   * was negotiated by the UI so the plotted download size is the one confirmed.
   */
  start(instanceId: string, opts?: { plan?: InstallationPlan }): void {
    if (this.isInstalling(instanceId)) {
      throw new AppError(
        "INSTALL_IN_PROGRESS",
        `Instance '${instanceId}' is already being installed`,
        409,
      );
    }
    const onProgress = this.onDownloadProgress(instanceId);
    const onCompleted = this.onTaskCompleted(instanceId);
    this.downloadManager.events.on("progress", onProgress);
    this.downloadManager.events.on("task-completed", onCompleted);
    const trackerOff = () => {
      if (session.heartbeat) clearInterval(session.heartbeat);
      this.downloadManager.events.off("progress", onProgress);
      this.downloadManager.events.off("task-completed", onCompleted);
    };
    const session: Session = {
      instanceId,
      phase: "CREATED",
      control: "run",
      pending: new Map(),
      completedBytes: 0,
      ...(opts?.plan !== undefined ? { plan: opts.plan } : {}),
      trackerOff,
    };
    this.sessions.set(instanceId, session);
    // drain loops run to completion in the background; failures surface via events
    void this.run(instanceId, session).catch((err) => {
      this.logger.error({ instanceId, err }, "install run crashed");
      this.fail(instanceId, session, err);
    });
  }

  /** Requests a pause. Takes effect at the next safe boundary. */
  pause(instanceId: string): void {
    const s = this.sessions.get(instanceId);
    if (!s) return;
    s.control = "pause";
    // Suspend in-flight/queued work of this install so .part data is preserved.
    for (const t of this.downloadManager.list()) {
      if (s.pending.has(t.dest) && (t.status === "pending" || t.status === "downloading")) {
        this.downloadManager.pause(t.taskId);
      }
    }
  }

  /** Resumes a paused install from its saved .part data. */
  resume(instanceId: string): void {
    const s = this.sessions.get(instanceId);
    if (!s || s.phase !== "PAUSED") return;
    s.control = "run";
    for (const t of this.downloadManager.list()) {
      if (s.pending.has(t.dest) && t.status === "paused") {
        this.downloadManager.resume(t.taskId);
      }
    }
    void this.run(instanceId, s).catch((err) => {
      this.logger.error({ instanceId, err }, "install resume crashed");
      this.fail(instanceId, s, err);
    });
  }

  /** Cancels the install. Already-downloaded cache is intentionally kept. */
  cancel(instanceId: string): void {
    const s = this.sessions.get(instanceId);
    if (!s) return;
    s.control = "cancel";
    for (const t of this.downloadManager.list()) {
      if (s.pending.has(t.dest) && ["pending", "downloading", "paused"].includes(t.status)) {
        this.downloadManager.cancel(t.taskId);
      }
    }
    // Reflect the request immediately even though the run loop may still be busy
    // in a long PREPARING/loader build; the race in run() will end it at CANCELLED.
    if (!TERMINAL_PHASES.has(s.phase)) {
      if (s.heartbeat) clearInterval(s.heartbeat);
      delete s.heartbeat;
      s.stage = "正在取消…";
      this.publish(instanceId, s);
    }
  }

  // ---------------------------------------------------------------------------
  // lifecycle
  // ---------------------------------------------------------------------------

  private async run(instanceId: string, s: Session): Promise<void> {
    const instance = await this.instances.get(instanceId);

    this.setPhase(instanceId, s, instance.id, "ANALYZING");
    const versionId = await resolveInstallVersionId(this.loaders, this.versions, instance);
    if (!(await this.yieldIfStop(instanceId, s))) return;

    this.setPhase(instanceId, s, instance.id, "PLANNING");
    const plan = s.plan ?? (await this.plans.build(instance));
    s.plan = plan;
    s.pending = new Map(
      plan.tasks
        .filter((t) => !t.cached && t.kind !== "LOADER")
        .map((t) => [t.path, t.size]),
    );
    s.completedBytes = 0;
    if (!(await this.yieldIfStop(instanceId, s))) return;

    this.publish(instanceId, s);
    const resolved = await this.versions.resolve(versionId);

    // PREPARING: materialize the loader (Forge/Fabric/NeoForge binary pack) before
    // game files, so the patched client jar exists for provisioning.
    this.setPhase(instanceId, s, instance.id, "PREPARING");
    if (instance.loader !== "vanilla" && instance.loaderVersion) {
      const adapter = this.loaders.get(instance.loader);
      if (adapter) {
        const loaderVersion = instance.loaderVersion;
        const startedAt = Date.now();
        this.setStage(s, `构建加载器（下载并二进制补丁）… 已用时 0s`);
        s.heartbeat = setInterval(() => {
          this.setStage(s, `构建加载器（下载并二进制补丁）… 已用时 ${Math.round((Date.now() - startedAt) / 1000)}s`);
        }, 1000);
        const cancelled = await this.runLoaderBuildWithCancel(s, () =>
          adapter.install(instance.minecraftVersion, loaderVersion),
        );
        if (s.heartbeat) clearInterval(s.heartbeat);
        delete s.heartbeat;
        if (cancelled) {
          // Leave the (idempotent, global-cache) loader build to finish detached;
          // stop the install now so the UI+DB turn CANCELLED instead of waiting
          // minutes on a build that may also be hung.
          this.setStage(s, "正在取消…");
        }
      }
    }
    if (!(await this.yieldIfStop(instanceId, s))) return;

    // DOWNLOADING: client jar + libraries + natives + assets + extraction.
    this.setPhase(instanceId, s, instance.id, "DOWNLOADING");
    const nativesDir = this.instances.nativesDirectory(instanceId, resolved.id);
    try {
      await this.downloads.provision(resolved, {
        nativesDir,
        mirrorVersionId: instance.minecraftVersion,
      });
    } catch (err) {
      if (s.control === "cancel") {
        this.setPhase(instanceId, s, instance.id, "CANCELLED");
        return;
      }
      if (s.control === "pause") {
        this.setPhase(instanceId, s, instance.id, "PAUSED");
        return;
      }
      throw err;
    }
    if (!(await this.yieldIfStop(instanceId, s))) return;

    // INSTALLING: instance-scoped auto-dependencies (Fabric API, QSL, ...).
    this.setPhase(instanceId, s, instance.id, "INSTALLING");
    const depsStartedAt = Date.now();
    this.setStage(s, `安装实例依赖… 已用时 0s`);
    s.heartbeat = setInterval(() => {
      this.setStage(s, `安装实例依赖… 已用时 ${Math.round((Date.now() - depsStartedAt) / 1000)}s`);
    }, 1000);
    try {
      await this.autoDeps.installForInstance(instance.id, instance.minecraftVersion, instance.loader);
    } finally {
      if (s.heartbeat) clearInterval(s.heartbeat);
      delete s.heartbeat;
    }
    if (!(await this.yieldIfStop(instanceId, s))) return;

    // FINALIZING: complete integrity check (§32). The download pipeline already
    // SHA1-verifies every artifact it fetches, so this is a lightweight "safety
    // net" that catches anything missing/skipped before we mark the instance READY.
    this.setPhase(instanceId, s, instance.id, "FINALIZING");
    const integrity = await this.verifyInstallation(instance);
    if (integrity.length > 0) {
      throw new IntegrityVerificationError(integrity);
    }
    if (BINARY_PATCH_LOADERS.has(instance.loader)) {
      await this.verifyLoaderClientForgeMarker(instance);
    }
    if (!(await this.yieldIfStop(instanceId, s))) return;

    this.setPhase(instanceId, s, instance.id, "READY");
  }

  /**
   * Completeness check before READY: version.json, client jar, every resolved
   * library/native artifact, the extracted natives dir, and the asset index
   * must all be present and non-empty on disk (§32). Returns the list of
   * missing artifacts, or an empty array when the instance is complete.
   */
  private async verifyInstallation(instance: {
    id: string;
    minecraftVersion: string;
    loader: string;
    loaderVersion: string | null;
  }): Promise<Array<{ path: string; reason: string }>> {
    const missing: Array<{ path: string; reason: string }> = [];
    const check = (p: string, expected?: string): void => {
      let ok = false;
      try {
        const st = fs.statSync(p);
        ok = st.isFile() && st.size > 0;
      } catch {
        ok = false;
      }
      if (!ok) missing.push({ path: p, reason: expected ?? "file missing or empty" });
    };

    const versionId = await resolveInstallVersionId(this.loaders, this.versions, instance);
    const resolved = await this.versions.resolve(versionId);

    // version.json
    const safeId = versionId.replace(/[^a-zA-Z0-9._-]/g, "_");
    check(path.join(this.config.versionsDir, safeId, `${safeId}.json`), versionId);

    // client jar
    const client = this.downloads.clientJarPath(resolved);
    check(client, "game client jar");

    // libraries + native jars (skip locally-produced loader artifacts; those are
    // validated separately by verifyLoaderClientForgeMarker)
    const resolver = new LibraryResolver(this.config);
    const resolution = resolver.resolve(resolved.libraries, currentRuntime());
    for (const lib of [...resolution.classpath, ...resolution.natives]) {
      if (lib.artifact.producedLocally) continue;
      check(lib.artifact.file, lib.name);
    }

    // extracted natives dir (must contain at least one extracted file)
    if (resolution.natives.length > 0) {
      const nativesDir = this.instances.nativesDirectory(instance.id, resolved.id);
      let extracted = false;
      try {
        extracted = fs
          .readdirSync(nativesDir, { recursive: true })
          .some((e) => typeof e === "string" && fs.statSync(path.join(nativesDir, e)).isFile());
      } catch {
        extracted = false;
      }
      if (!extracted) missing.push({ path: nativesDir, reason: "natives not extracted" });
    }

    // asset index
    if (resolved.assetIndex && resolved.assetIndex.id) {
      const safeIndex = resolved.assetIndex.id.replace(/[^a-zA-Z0-9._-]/g, "_");
      check(path.join(this.config.assetIndexesDir, `${safeIndex}.json`), "asset index");
    }

    return missing;
  }

  /** Returns false when the session is being paused/cancelled and should stop. */
  private async yieldIfStop(instanceId: string, s: Session): Promise<boolean> {
    if (s.control === "cancel") {
      this.setPhase(instanceId, s, instanceId, "CANCELLING");
      this.setPhase(instanceId, s, instanceId, "CANCELLED");
      return false;
    }
    if (s.control === "pause") {
      // pause is only meaningful while downloading; otherwise defer to next boundary
      if (s.phase === "DOWNLOADING") {
        this.setPhase(instanceId, s, instanceId, "PAUSED");
        return false;
      }
    }
    return true;
  }

  /**
   * Runs a loader build while racing a cancel request. Returns `true` when the
   * user cancelled mid-build (the build is abandoned to finish detached — it
   * writes only to the idempotent global library/version store), or `false`
   * when the build settled with the result in `fn`'s promise. Build errors are
   * re-thrown so the main run loop handles them normally.
   */
  private async runLoaderBuildWithCancel(
    s: Session,
    fn: () => Promise<unknown>,
  ): Promise<boolean> {
    let buildError: unknown = null;
    const build = fn().catch((err) => {
      buildError = err;
    });
    const wasCancelled = await new Promise<boolean>((resolve) => {
      const poll = setInterval(() => {
        if (s.control === "cancel") {
          clearInterval(poll);
          resolve(true);
        }
      }, 250);
      // build always settles (its rejection is captured above)
      void build.then(() => {
        clearInterval(poll);
        resolve(false);
      });
    });
    if (wasCancelled) return true;
    if (buildError !== null) throw buildError;
    return false;
  }

  private async verifyLoaderClientForgeMarker(instance: {
    id: string;
    minecraftVersion: string;
    loader: string;
    loaderVersion: string | null;
  }): Promise<void> {
    const versionId = await resolveInstallVersionId(this.loaders, this.versions, instance);
    const resolved = await this.versions.resolve(versionId);
    const client =
      resolved.libraries
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((l) => (l as any).artifact)
        .filter((a: { producedLocally?: boolean; file: string; urls?: unknown[] }) => a && a.producedLocally === true && a.urls?.length === 0)
        .find((a: { file: string }) => /client[^\\/]*\.jar$/i.test(a.file));
    if (!client) return; // no locally-produced client => nothing to verify
    const { readFileSync } = await import("node:fs");
    const AdmZip = (await import("adm-zip")).default;
    let ok = false;
    try {
      const zip = new AdmZip(readFileSync(client.file));
      ok = zip.getEntry(FORGE_PATCH_MARKER) !== null;
    } catch {
      ok = false;
    }
    if (!ok) {
      throw new AppError(
        "FORGE_PATCH_FAILED",
        `Loader client jar '${client.file}' is missing the '${FORGE_PATCH_MARKER}' marker; it was not patched correctly by the installer.`,
        500,
      );
    }
  }

  private fail(instanceId: string, s: Session, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.setPhase(instanceId, s, instanceId, "FAILED");
    void this.instances.setStatus(instanceId, "BROKEN", { lastError: message });
    const snap = this.toSnapshot(instanceId, s);
    snap.error = message;
    this.publish(instanceId, s, snap);
  }

  // ---------------------------------------------------------------------------
  // progress + events
  // ---------------------------------------------------------------------------

  private onDownloadProgress = (instanceId: string) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return () => {
      if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          const s = this.sessions.get(instanceId);
          if (s && s.phase === "DOWNLOADING") this.publish(instanceId, s);
        }, PROGRESS_FLUSH_MS);
        timer.unref?.();
      }
    };
  };

  private onTaskCompleted =
    (instanceId: string) =>
    (snap: { id: string; dest: string }): void => {
      const s = this.sessions.get(instanceId);
      if (!s || !s.pending.has(snap.dest)) return;
      s.completedBytes += s.pending.get(snap.dest) ?? 0;
      s.pending.delete(snap.dest);
    };

  private setStage(s: Session, stage: string): void {
    if (s.stage !== stage) s.stage = stage;
    this.publish(s.instanceId, s);
  }

  private setPhase(instanceId: string, s: Session, _instance: string, phase: InstallPhase): void {
    void _instance;
    try {
      transition(s.phase, phase);
    } catch (err) {
      this.logger.warn({ instanceId, from: s.phase, to: phase }, "skipping illegal phase transition");
      return;
    }
    s.phase = phase;
    const status = instanceStatusForPhase(phase);
    if (phase === "READY") {
      void this.instances.setStatus(instanceId, status, {
        installedAt: new Date(),
        lastError: null,
      });
    } else {
      void this.instances.setStatus(instanceId, status);
    }
    this.publish(instanceId, s);
  }

  private toSnapshot(instanceId: string, s: Session): InstallationSnapshot {
    const plan = s.plan;
    const totalBytes = plan?.downloadBytes ?? 0;
    const doneBytes = s.completedBytes;
    const tasksDone = plan ? plan.pendingFiles - s.pending.size : 0;
    const speedBps = this.downloadManager.stats().aggregateSpeedBps;
    const etaSec =
      speedBps > 0 ? Math.round(Math.max(0, totalBytes - doneBytes) / speedBps) : null;
    const progressPct = totalBytes > 0 ? (doneBytes / totalBytes) * 100 : s.phase === "READY" ? 100 : 0;

    return {
      instanceId,
      phase: s.phase,
      instanceStatus: instanceStatusForPhase(s.phase),
      progressPct: Math.min(100, Math.max(0, progressPct)),
      downloadedBytes: Math.round(doneBytes),
      totalBytes,
      speedBps,
      etaSec,
      tasksDone,
      tasksTotal: plan?.pendingFiles ?? 0,
      ...(s.stage !== undefined ? { message: s.stage } : {}),
      updatedAt: Date.now(),
    };
  }

  private publish(instanceId: string, s: Session, snap?: InstallationSnapshot): void {
    if (["READY", "FAILED", "CANCELLED"].includes(s.phase)) delete s.stage;
    const payload: InstallationSnapshot = snap ?? this.toSnapshot(instanceId, s);
    this.bus.publish(Events.INSTALL, payload, instanceId);
    if (["READY", "FAILED", "CANCELLED"].includes(s.phase)) {
      s.trackerOff();
      this.sessions.delete(instanceId);
    }
  }
}