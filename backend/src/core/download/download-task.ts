import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { AppConfig } from "../../config/env.js";
import { Logger } from "../../config/logger.js";
import { HttpClient } from "../../infrastructure/http/http-client.js";
import { sha1File } from "../../utils/hash.js";
import {
  DownloadKind,
  DownloadRequest,
  DownloadStatus,
  DownloadTaskSnapshot,
} from "./types.js";

const PROGRESS_EMIT_INTERVAL_MS = 250;
const SPEED_WINDOW_MS = 5000;
const MAX_ATTEMPTS_PER_URL = 3;

export class DownloadInterruptedError extends Error {
  constructor(public readonly reason: "paused" | "cancelled") {
    super(reason);
    this.name = "DownloadInterruptedError";
  }
}

export class DownloadVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DownloadVerificationError";
  }
}

interface SpeedSample {
  t: number;
  bytes: number;
}

/**
 * A single downloadable artifact: owns its IO lifecycle (streaming, hashing,
 * verification, resume). The manager only schedules tasks and forwards events.
 */
export class DownloadTask {
  readonly id: string;
  readonly request: DownloadRequest;

  private statusValue: DownloadStatus = "pending";
  private receivedValue = 0;
  private totalBytesValue: number | null;
  private errorValue: string | undefined;

  private pauseRequested = false;
  private cancelRequested = false;
  private currentAbort: AbortController | null = null;

  private readonly samples: SpeedSample[] = [];
  private lastEmitAt = 0;

  constructor(
    id: string,
    request: DownloadRequest,
    private readonly deps: { http: HttpClient; config: AppConfig; logger: Logger },
  ) {
    this.id = id;
    this.request = request;
    this.totalBytesValue = request.size ?? null;
  }

  get status(): DownloadStatus {
    return this.statusValue;
  }

  get received(): number {
    return this.receivedValue;
  }

  get totalBytes(): number | null {
    return this.totalBytesValue;
  }

  snapshot(): DownloadTaskSnapshot {
    return {
      taskId: this.id,
      kind: this.request.kind,
      dest: this.request.dest,
      status: this.statusValue,
      receivedBytes: this.receivedValue,
      totalBytes: this.totalBytesValue,
      progressPct: this.progressPct(),
      speedBps: this.speedBps(),
      etaSec: this.etaSec(),
      ...(this.errorValue !== undefined ? { error: this.errorValue } : {}),
    };
  }

  progressPct(): number {
    const total = this.request.size ?? this.totalBytesValue ?? 0;
    if (total <= 0) return 0;
    return Math.min(100, Math.round((this.receivedValue / total) * 1000) / 10);
  }

  speedBps(): number {
    const now = Date.now();
    const cutoff = now - SPEED_WINDOW_MS;
    while (this.samples.length > 2 && this.samples[0]!.t < cutoff) this.samples.shift();
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    if (!first || !last || last.t <= first.t) return 0;
    return Math.max(0, ((last.bytes - first.bytes) / (last.t - first.t)) * 1000);
  }

  etaSec(): number | null {
    const total = this.request.size ?? this.totalBytesValue;
    if (!total || total <= 0) return null;
    const speed = this.speedBps();
    if (speed < 1) return null;
    return Math.ceil(Math.max(0, total - this.receivedValue) / speed);
  }

  /** Thread-safe pause request; takes effect at the next IO tick. */
  requestPause(): void {
    if (this.statusValue === "downloading" || this.statusValue === "pending") {
      this.pauseRequested = true;
      this.currentAbort?.abort();
    }
  }

  requestCancel(): void {
    this.cancelRequested = true;
    this.currentAbort?.abort();
  }

  prepareResume(): void {
    this.pauseRequested = false;
    this.cancelRequested = false;
    this.errorValue = undefined;
    this.statusValue = "pending";
  }

  /** Marks a still-queued task as paused without aborting any IO. */
  hold(): void {
    if (this.statusValue === "pending") {
      this.statusValue = "paused";
    }
  }

  /**
   * Runs the download to completion.
   * Resolves when the artifact is verified on disk.
   * Rejects with DownloadInterruptedError on pause/cancel, other Error on failure.
   */
  async run(events: EventEmitter): Promise<void> {
    const partFile = `${this.request.dest}.part`;
    fs.mkdirSync(path.dirname(this.request.dest), { recursive: true });

    if (await this.finalFileValid()) {
      this.receivedValue = this.request.size ?? fs.statSync(this.request.dest).size;
      this.totalBytesValue = this.receivedValue;
      this.statusValue = "completed";
      this.emitProgress(events);
      return;
    }

    let urlIndex = 0;
    let attempt = 0;

    while (true) {
      this.throwIfRequested();

      const url = this.request.urls[urlIndex];
      if (!url) throw new DownloadVerificationError(`No usable mirror left for ${this.request.dest}`);

      const offsetBefore = this.readPartSize(partFile);
      const controller = new AbortController();
      this.currentAbort = controller;

      try {
        this.statusValue = "downloading";
        await this.streamOnce(url, partFile, offsetBefore, controller.signal, events);

        fs.renameSync(partFile, this.request.dest);
        this.totalBytesValue = this.receivedValue;
        this.statusValue = "completed";
        this.emitProgress(events);
        return;
      } catch (err) {
        this.currentAbort = null;

        if (this.cancelRequested || this.pauseRequested) {
          this.throwIfRequested();
        }

        const verificationFailure = err instanceof DownloadVerificationError;
        const httpStatusFailure = err instanceof Error && /^HTTP \d{3}/.test(err.message);

        if (verificationFailure) {
          // corrupted partial data: discard and restart cleanly
          this.removePart();
        }

        if (httpStatusFailure && urlIndex < this.request.urls.length - 1) {
          urlIndex += 1;
          attempt = 0;
          continue;
        }

        attempt += 1;
        if (attempt >= MAX_ATTEMPTS_PER_URL) {
          if (urlIndex < this.request.urls.length - 1) {
            urlIndex += 1;
            attempt = 0;
            continue;
          }
          this.statusValue = "failed";
          this.errorValue = err instanceof Error ? err.message : String(err);
          throw err;
        }

        const backoffMs = 400 * 2 ** attempt;
        await this.interruptibleSleep(backoffMs);
      } finally {
        this.currentAbort = null;
      }
    }
  }

  private throwIfRequested(): void {
    if (this.cancelRequested) {
      this.removePart();
      this.statusValue = "cancelled";
      throw new DownloadInterruptedError("cancelled");
    }
    if (this.pauseRequested) {
      this.statusValue = "paused";
      throw new DownloadInterruptedError("paused");
    }
  }

  private async interruptibleSleep(ms: number): Promise<void> {
    const step = 50;
    let waited = 0;
    while (waited < ms) {
      if (this.cancelRequested || this.pauseRequested) this.throwIfRequested();
      await new Promise((r) => setTimeout(r, step));
      waited += step;
    }
  }

  private async streamOnce(
    url: string,
    partFile: string,
    offset: number,
    signal: AbortSignal,
    events: EventEmitter,
  ): Promise<void> {
    const res = await this.deps.http.openStream(
      url,
      offset > 0
        ? { rangeStart: offset, signal }
        : { signal },
    );

    try {
      if (res.status >= 400) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }

      const resumed = res.status === 206 && offset > 0;
      const hash: crypto.Hash | null = this.request.sha1 ? crypto.createHash("sha1") : null;

      let writeStream: fs.WriteStream;
      if (resumed) {
        if (hash) await this.hashPrefix(partFile, hash);
        writeStream = fs.createWriteStream(partFile, { flags: "a" });
        this.receivedValue = offset;
      } else {
        this.receivedValue = 0;
        writeStream = fs.createWriteStream(partFile, { flags: "w" });
      }

      if (res.contentLength !== null) {
        this.totalBytesValue = this.receivedValue + res.contentLength;
      } else if (!resumed && this.request.size !== undefined) {
        this.totalBytesValue = this.request.size;
      }

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const failOnce = (err: unknown): void => {
          if (settled) return;
          settled = true;
          res.stream.destroy();
          writeStream.destroy();
          reject(err instanceof Error ? err : new Error(String(err)));
        };

        res.stream.on("data", (chunk: Buffer) => {
          this.receivedValue += chunk.length;
          hash?.update(chunk);
          this.samples.push({ t: Date.now(), bytes: this.receivedValue });
          this.emitThrottled(events);
        });
        res.stream.on("error", failOnce);
        writeStream.on("error", failOnce);
        writeStream.on("finish", () => {
          if (settled) return;

          if (this.request.sha1 && hash) {
            const actual = hash.digest("hex");
            if (actual.toLowerCase() !== this.request.sha1.toLowerCase()) {
              failOnce(new DownloadVerificationError(
                `SHA1 mismatch for ${path.basename(this.request.dest)}: expected ${this.request.sha1}, got ${actual}`,
              ));
              return;
            }
          }
          if (this.request.size !== undefined && this.receivedValue !== this.request.size) {
            failOnce(new DownloadVerificationError(
              `Size mismatch for ${path.basename(this.request.dest)}: expected ${this.request.size}, got ${this.receivedValue}`,
            ));
            return;
          }
          settled = true;
          resolve();
        });

        res.stream.pipe(writeStream);
      });
    } finally {
      res.stream.destroy();
    }
  }

  private emitThrottled(events: EventEmitter): void {
    const now = Date.now();
    if (now - this.lastEmitAt >= PROGRESS_EMIT_INTERVAL_MS) {
      this.lastEmitAt = now;
      this.emitProgress(events);
    }
  }

  private emitProgress(events: EventEmitter): void {
    events.emit("progress", this.snapshot());
  }

  private async hashPrefix(file: string, hash: crypto.Hash): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const s = fs.createReadStream(file);
      s.on("data", (c: string | Buffer) => hash.update(c));
      s.on("error", reject);
      s.on("end", () => resolve());
    });
  }

  private readPartSize(partFile: string): number {
    try {
      return fs.statSync(partFile).size;
    } catch {
      return 0;
    }
  }

  private removePart(): void {
    try {
      fs.rmSync(`${this.request.dest}.part`, { force: true });
    } catch {
      /* best effort */
    }
  }

  private async finalFileValid(): Promise<boolean> {
    try {
      const st = fs.statSync(this.request.dest);
      if (st.size === 0) return false;
      if (this.request.size !== undefined && st.size !== this.request.size) return false;
      // A size match alone is not enough: a file can be corrupted but same length.
      // Only trust an existing file when we can verify its SHA1 (when one is
      // expected), mirroring the verification done on the download path.
      if (this.request.sha1) {
        const actual = await sha1File(this.request.dest);
        if (actual.toLowerCase() !== this.request.sha1.toLowerCase()) return false;
      }
      return true;
    } catch {
      return false;
    }
  }
}
