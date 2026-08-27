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
import { urlCandidates, clientJarMirrorUrls, MirrorMode } from "../infrastructure/mirror/mirrors.js";
import { assertInside } from "../utils/paths.js";
import type { SettingsService } from "./settings-service.js";

export interface ProvisionResult {
  clientJar: string;
  classpathLibraries: ResolvedLibrary[];
  nativeLibraries: ResolvedNativeLibrary[];
  nativesDir: string;
  assetIndex: AssetIndexContent | null;
  downloaded: number;
  failed: number;
  /** Asset objects the user paused mid-download; install must wait for resume. */
  paused: number;
}

/**
 * Orchestrates all file provisioning for a resolved version:
 *   version JSON -> client jar -> libraries -> natives extraction -> assets.
 *
 * Everything is idempotent: present+valid files are never re-downloaded,
 * which also makes this the engine behind repair.
 */
export class DownloadService {
  private readonly fallbackMirrorMode: MirrorMode;

  constructor(
    private readonly config: AppConfig,
    private readonly downloads: DownloadManager,
    private readonly assets: AssetService,
    private readonly bus: EventBus,
    private readonly logger: Logger,
    private readonly http: HttpClient,
    mirrorMode: MirrorMode = "auto",
    private readonly settings?: SettingsService,
  ) {
    this.fallbackMirrorMode = mirrorMode;
  }

  private async getMirrorMode(): Promise<MirrorMode> {
    if (this.settings) return this.settings.getMirrorMode();
    return this.fallbackMirrorMode;
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

  /**
   * Ensures the game client jar is present.
   *
   * @param mirrorVersionId the canonical Minecraft version id used for the
   *   BMCLAPI `/version/<id>/client` endpoint. For loader instances (Forge /
   *   NeoForge) this is the underlying vanilla version (`instance.minecraftVersion`)
   *   because their client jar IS the vanilla game body; leaving it undefined
   *   falls back to `resolved.id`.
   */
  async ensureClientJar(
    resolved: ResolvedVersion,
    opts?: { mirrorVersionId?: string },
  ): Promise<string> {
    const artifact = resolved.downloads.client;
    const dest = this.clientJarPath(resolved);
    const mirrorId = opts?.mirrorVersionId ?? resolved.id;

    if (!artifact) {
      // Inheritance-based loader whose version json has no own downloads block:
      // its client jar is the underlying vanilla game body, so fetch it via the
      // mirror's /version/<id>/client endpoint.
      if (mirrorId) {
        await this.runBatch([
          {
            urls: clientJarMirrorUrls(mirrorId),
            dest,
            kind: "client",
            context: { version: resolved.id },
          },
        ]);
        return dest;
      }
      if (fs.existsSync(dest)) return dest;
      throw new Error(`Version '${resolved.id}' provides no client download metadata`);
    }

    const mirrorMode = await this.getMirrorMode();
    // The rest of the manifest lives on Mojang (piston-data has no generic mirror
    // rule), but the client jar itself is served domestically by BMCLAPI as
    // /version/<id>/client. Give it priority in mirror mode so loader instances
    // (Forge etc.) also download the game body fast right after creation.
    const official = urlCandidates(artifact.url, mirrorMode);
    const mirrored = clientJarMirrorUrls(mirrorId);
    const urls =
      mirrorMode === "bmclapi" ? [...mirrored, ...official] : [...official, ...mirrored];
    await this.runBatch([
      {
        urls,
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
    const mirrorMode = await this.getMirrorMode();
    const requests: DownloadRequest[] = libraries
      .filter((lib) => lib.artifact.urls.length > 0)
      .map((lib) => ({
        urls: lib.artifact.urls.flatMap((u) => urlCandidates(u, mirrorMode)),
        dest: lib.artifact.file,
        ...(lib.artifact.sha1 !== undefined ? { sha1: lib.artifact.sha1 } : {}),
        ...(lib.artifact.size !== undefined ? { size: lib.artifact.size } : {}),
        kind: "library" as const,
        context: { name: lib.name },
      }));
    await this.runBatch(requests);
  }

  async ensureNativeJars(natives: ResolvedNativeLibrary[]): Promise<void> {
    const mirrorMode = await this.getMirrorMode();
    const requests: DownloadRequest[] = natives.map((n) => ({
      urls: n.artifact.urls.flatMap((u) => urlCandidates(u, mirrorMode)),
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
  ): Promise<{ completed: number; failed: number; paused: number }> {
    return this.assets.ensureAssets(index, indexId, opts);
  }

  /** Full provisioning pipeline used by launch + repair. */
  async provision(
    resolved: ResolvedVersion,
    opts: { nativesDir: string; deepVerifyAssets?: boolean; mirrorVersionId?: string },
  ): Promise<ProvisionResult> {
    const clientJar = await this.ensureClientJar(resolved, {
      mirrorVersionId: opts.mirrorVersionId ?? resolved.id,
    });

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
        : { completed: 0, failed: 0, paused: 0 };

    return {
      clientJar,
      classpathLibraries: resolution.classpath,
      nativeLibraries: resolution.natives,
      nativesDir: opts.nativesDir,
      assetIndex,
      downloaded: assetStats.completed,
      failed: assetStats.failed,
      paused: assetStats.paused,
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

  /**
   * Enqueues a batch and awaits it. Failures throw BatchDownloadError (with the
   * full list); a user-paused task is NOT a failure — it is reported via the
   * returned count so the install manager can hold the install in PAUSED.
   */
  private async runBatch(requests: DownloadRequest[]): Promise<number> {
    if (requests.length === 0) return 0;
    const outcomes = requests.map((r) => this.downloads.enqueue(r).outcome);
    const results = await Promise.all(outcomes);
    const failures = results.filter((r: TaskOutcome) => r.status === "failed");
    const paused = results.filter((r: TaskOutcome) => r.status === "paused").length;
    if (failures.length > 0) {
      throw new BatchDownloadError(failures.map((r) => ({
        dest: r.snapshot.dest,
        error: r.snapshot.error ?? r.status,
      })));
    }
    return paused;
  }
}

/** Aggregates multiple download failures so install/launch error messages
 *  list every failed file instead of only the first one (#6). */
export class BatchDownloadError extends Error {
  readonly failures: Array<{ dest: string; error: string }>;
  constructor(failures: Array<{ dest: string; error: string }>) {
    const lines = failures
      .map((f) => `  • ${f.dest}: ${f.error}`)
      .join("\n");
    super(`${failures.length} download(s) failed:\n${lines}`);
    this.name = "BatchDownloadError";
    this.failures = failures;
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
