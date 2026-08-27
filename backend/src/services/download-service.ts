import fs from "node:fs";
import path from "node:path";
import { AppConfig } from "../config/env.js";
import { Logger } from "../config/logger.js";
import { HttpClient } from "../infrastructure/http/http-client.js";
import { EventBus, Events, DownloadProgressData } from "../websocket/events.js";
import { DownloadManager, TaskOutcome } from "../core/download/download-manager.js";
import { DownloadRequest } from "../core/download/types.js";
import { ResolvedLibrary, ResolvedNativeLibrary, ResolvedVersion } from "../core/version/types.js";
import { AssetService, AssetIndexContent } from "../core/assets/asset-service.js";
import { LibraryResolver } from "../core/libraries/library-resolver.js";
import { currentRuntime } from "../utils/runtime-env.js";
import { prepareNatives } from "../core/natives/native-extractor.js";
import { urlCandidates, MirrorMode } from "../infrastructure/mirror/mirrors.js";
import { assertInside } from "../utils/paths.js";

export interface ProvisionResult {
  clientJar: string;
  classpathLibraries: ResolvedLibrary[];
  nativeLibraries: ResolvedNativeLibrary[];
  nativesDir: string;
  assetIndex: AssetIndexContent | null;
  downloaded: number;
  failed: number;
}

/**
 * Orchestrates all file provisioning for a resolved version:
 *   version JSON -> client jar -> libraries -> natives extraction -> assets.
 *
 * Everything is idempotent: present+valid files are never re-downloaded,
 * which also makes this the engine behind repair.
 */
export class DownloadService {
  private readonly mirrorMode: MirrorMode;

  constructor(
    private readonly config: AppConfig,
    private readonly downloads: DownloadManager,
    private readonly assets: AssetService,
    private readonly bus: EventBus,
    private readonly logger: Logger,
    private readonly http: HttpClient,
    mirrorMode: MirrorMode = "auto",
  ) {
    this.mirrorMode = mirrorMode;
  }

  /** Shared library/asset store location (used by instance repair too). */
  clientJarPath(resolved: ResolvedVersion): string {
    const safeId = resolved.jarId.replace(/[^a-zA-Z0-9._-]/g, "_");
    return path.join(this.config.versionsDir, safeId, `${safeId}.jar`);
  }

  /**
   * authlib-injector agent used for Yggdrasil (external) login. It rewrites
   * the game's authentication endpoints so the player name shows up in the
   * main menu and skins are fetched from the external auth server (LittleSkin).
   */
  authlibInjectorJar(): string {
    return path.join(this.config.librariesDir, "authlib-injector", "authlib-injector.jar");
  }

  /** Idempotent download of the latest authlib-injector release. */
  async ensureAuthlibInjector(): Promise<string> {
    const dest = this.authlibInjectorJar();
    if (fs.existsSync(dest)) return dest;
    // Resolve the current release URL from the official download API, then
    // download the artifact through the download pipeline (mirror friendly).
    const latest = await this.http.getJson<{ download_url?: string }>(
      "https://authlib-injector.yushi.moe/artifact/latest.json",
    );
    if (!latest.download_url) {
      throw new Error("authlib-injector: latest.json did not provide download_url");
    }
    await this.runBatch([
      {
        urls: [latest.download_url],
        dest,
        kind: "other",
        context: { name: "authlib-injector" },
      },
    ]);
    return dest;
  }

  async ensureClientJar(resolved: ResolvedVersion): Promise<string> {
    const artifact = resolved.downloads.client;
    const dest = this.clientJarPath(resolved);

    if (!artifact) {
      // Very old versions ship no downloads block; jar may exist from manual install
      if (fs.existsSync(dest)) return dest;
      throw new Error(`Version '${resolved.id}' provides no client download metadata`);
    }

    await this.runBatch([
      {
        urls: urlCandidates(artifact.url, this.mirrorMode),
        dest,
        sha1: artifact.sha1,
        size: artifact.size,
        kind: "client",
        context: { version: resolved.id },
      },
    ]);

    return dest;
  }

  async ensureLibraries(libraries: ResolvedLibrary[]): Promise<void> {
    const requests: DownloadRequest[] = libraries
      .filter((lib) => lib.artifact.urls.length > 0)
      .map((lib) => ({
        urls: lib.artifact.urls.flatMap((u) => urlCandidates(u, this.mirrorMode)),
        dest: lib.artifact.file,
        ...(lib.artifact.sha1 !== undefined ? { sha1: lib.artifact.sha1 } : {}),
        ...(lib.artifact.size !== undefined ? { size: lib.artifact.size } : {}),
        kind: "library" as const,
        context: { name: lib.name },
      }));
    await this.runBatch(requests);
  }

  async ensureNativeJars(natives: ResolvedNativeLibrary[]): Promise<void> {
    const requests: DownloadRequest[] = natives.map((n) => ({
      urls: n.artifact.urls.flatMap((u) => urlCandidates(u, this.mirrorMode)),
      dest: n.artifact.file,
      ...(n.artifact.sha1 !== undefined ? { sha1: n.artifact.sha1 } : {}),
      ...(n.artifact.size !== undefined ? { size: n.artifact.size } : {}),
      kind: "native" as const,
      context: { name: n.name },
    }));
    await this.runBatch(requests);
  }

  async extractNatives(
    nativeLibs: ResolvedNativeLibrary[],
    nativesDir: string,
  ): Promise<void> {
    assertInside(this.config.instancesDir, nativesDir);
    await prepareNatives(nativeLibs, nativesDir, async () => {
      /* jars already ensured by ensureNativeJars */
    });
    this.logger.debug({ count: nativeLibs.length, nativesDir }, "natives extracted");
  }

  async ensureAssetIndex(resolved: ResolvedVersion): Promise<AssetIndexContent> {
    if (!resolved.assetIndex) {
      // pre-1.6 versions have no asset index at all
      return { objects: {}, virtual: true };
    }
    return this.assets.ensureAssetIndex({
      id: resolved.assetIndex.id,
      url: resolved.assetIndex.url,
      sha1: resolved.assetIndex.sha1,
      size: resolved.assetIndex.size,
    });
  }

  async ensureAssets(
    index: AssetIndexContent,
    indexId: string,
    opts?: { deepVerify?: boolean },
  ): Promise<{ completed: number; failed: number }> {
    return this.assets.ensureAssets(index, indexId, opts);
  }

  /** Full provisioning pipeline used by launch + repair. */
  async provision(
    resolved: ResolvedVersion,
    opts: { nativesDir: string; deepVerifyAssets?: boolean },
  ): Promise<ProvisionResult> {
    const clientJar = await this.ensureClientJar(resolved);

    const resolver = new LibraryResolver(this.config);
    const resolution = resolver.resolve(resolved.libraries, currentRuntime());

    await this.ensureLibraries(resolution.classpath);
    await this.ensureNativeJars(resolution.natives);
    await this.extractNatives(resolution.natives, opts.nativesDir);

    const assetIndex = await this.ensureAssetIndex(resolved);
    const indexId = resolved.assetIndex?.id ?? "legacy";
    const assetStats =
      Object.keys(assetIndex.objects).length > 0
        ? await this.ensureAssets(
            assetIndex,
            indexId,
            opts.deepVerifyAssets === true ? { deepVerify: true } : {},
          )
        : { completed: 0, failed: 0 };

    return {
      clientJar,
      classpathLibraries: resolution.classpath,
      nativeLibraries: resolution.natives,
      nativesDir: opts.nativesDir,
      assetIndex,
      downloaded: assetStats.completed,
      failed: assetStats.failed,
    };
  }

  stats() {
    return this.downloads.stats();
  }

  listTasks() {
    return this.downloads.list();
  }

  cancelTask(taskId: string): boolean {
    return this.downloads.cancel(taskId);
  }

  pauseTask(taskId: string): boolean {
    return this.downloads.pause(taskId);
  }

  resumeTask(taskId: string): boolean {
    return this.downloads.resume(taskId);
  }

  private async runBatch(requests: DownloadRequest[]): Promise<void> {
    if (requests.length === 0) return;
    const outcomes = requests.map((r) => this.downloads.enqueue(r).outcome);
    const results = await Promise.all(outcomes);
    const failures = results.filter(
      (r: TaskOutcome) => r.status !== "completed",
    );
    if (failures.length > 0) {
      const first = failures[0]!;
      throw new Error(
        `${failures.length} download(s) failed; first: ${first.snapshot.dest} — ${first.snapshot.error ?? first.status}`,
      );
    }
  }
}

/** Bridges raw download-manager events onto the unified event bus. */
export function wireDownloadEvents(manager: DownloadManager, bus: EventBus): void {
  // Completing thousands of tiny asset files in a burst would otherwise flood
  // every WS client (and the renderer) with one frame per file. Coalesce
  // completions into a single batched frame at most every COMPLETION_FLUSH_MS.
  const COMPLETION_FLUSH_MS = 300;
  let completed: Array<{ taskId: string; kind: string; dest: string }> = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const flushCompletions = (): void => {
    flushTimer = null;
    if (completed.length === 0) return;
    const batch = completed;
    completed = [];
    bus.publish(Events.DOWNLOAD_COMPLETED, { tasks: batch });
  };

  // Progress frames stream in once per task every ~250ms; with several tasks
  // downloading at once that would still fan out dozens of WS frames per second.
  // Coalesce them into one batched frame at most every PROGRESS_FLUSH_MS.
  const PROGRESS_FLUSH_MS = 250;
  let progresses: DownloadProgressData[] = [];
  let progressTimer: ReturnType<typeof setTimeout> | null = null;
  const flushProgresses = (): void => {
    progressTimer = null;
    if (progresses.length === 0) return;
    const batch = progresses;
    progresses = [];
    bus.publish(Events.DOWNLOAD_PROGRESS, { tasks: batch });
  };

  manager.events.on("progress", (snap) => {
    const data: DownloadProgressData = {
      taskId: snap.id,
      kind: snap.kind,
      progressPct: snap.progressPct,
      receivedBytes: snap.receivedBytes,
      totalBytes: snap.totalBytes,
      speedBps: Math.round(snap.speedBps),
      etaSec: snap.etaSec,
    };
    if (snap.progressPct >= 100) return;
    progresses.push(data);
    if (!progressTimer) progressTimer = setTimeout(flushProgresses, PROGRESS_FLUSH_MS);
  });
  manager.events.on("task-completed", (snap) => {
    completed.push({ taskId: snap.id, kind: snap.kind, dest: snap.dest });
    if (!flushTimer) flushTimer = setTimeout(flushCompletions, COMPLETION_FLUSH_MS);
  });
  manager.events.on("task-failed", (snap) => {
    bus.publish(Events.DOWNLOAD_FAILED, { taskId: snap.id, error: snap.error ?? "unknown" });
  });
}
