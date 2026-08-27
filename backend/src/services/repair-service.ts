import fs from "node:fs";
import { AppConfig } from "../config/env.js";
import { Logger } from "../config/logger.js";
import { EventBus, Events } from "../websocket/events.js";
import { VersionService } from "./version-service.js";
import { DownloadService } from "./download-service.js";
import { InstanceService } from "./instance-service.js";
import { AssetService } from "../core/assets/asset-service.js";
import { LibraryResolver } from "../core/libraries/library-resolver.js";
import { LoaderRegistry } from "../core/loaders/loader-registry.js";
import { currentRuntime } from "../utils/runtime-env.js";
import { ResolvedLibrary, ResolvedNativeLibrary } from "../core/version/types.js";
import { sha1File } from "../utils/hash.js";
import { AppError, InstanceNotFoundError } from "../errors/index.js";

export interface RepairReport {
  instanceId: string;
  versionId: string;
  checked: {
    client: boolean;
    libraries: number;
    libraryFailures: number;
    nativeJars: number;
    assetObjects: number;
    corruptAssetsRemoved: number;
  };
  redownloadedLibraries: number;
}

interface RepairProgressPayload {
  instanceId: string;
  stage: string;
  current: number;
  total: number;
}

/**
 * Verifies every artifact of an instance's version (existence + size + SHA1)
 * and re-downloads anything corrupt:
 *   check -> delete -> redownload -> SHA1 validation
 *
 * Emits `repair.progress` events for live UI feedback.
 */
export class RepairService {
  private readonly libraryResolver: LibraryResolver;

  constructor(
    private readonly config: AppConfig,
    private readonly versions: VersionService,
    private readonly downloads: DownloadService,
    private readonly instances: InstanceService,
    private readonly assets: AssetService,
    private readonly bus: EventBus,
    private readonly logger: Logger,
    private readonly loaders: LoaderRegistry,
  ) {
    this.libraryResolver = new LibraryResolver(config);
    void this.config;
  }

  async repair(instanceId: string, opts?: { deepAssets?: boolean }): Promise<RepairReport> {
    const instance = await this.instances.require(instanceId).catch(() => null);
    if (!instance) throw new InstanceNotFoundError(instanceId);

    const versionId = this.versionIdFor(instance);
    this.progress(instanceId, "resolve", 0, 1);
    const resolved = await this.versions.resolve(versionId);
    this.progress(instanceId, "resolve", 1, 1);

    const resolution = this.libraryResolver.resolve(resolved.libraries, currentRuntime());
    const nativesDir = this.instances.nativesDirectory(instance.id, resolved.id);

    // ---- client jar
    this.progress(instanceId, "client", 0, 1);
    const clientJar = await this.downloads.ensureClientJar(resolved);
    const clientOk = fs.existsSync(clientJar) && fs.statSync(clientJar).size > 0;
    this.progress(instanceId, "client", 1, 1);

    // ---- libraries audit (size first, SHA1 for anything suspicious or when metadata present)
    const all: Array<ResolvedLibrary | ResolvedNativeLibrary> = [
      ...resolution.classpath,
      ...resolution.natives,
    ];
    this.progress(instanceId, "libraries", 0, all.length);
    let done = 0;
    const badClass: ResolvedLibrary[] = [];
    const badNatives: ResolvedNativeLibrary[] = [];
    const isNative = (l: ResolvedLibrary | ResolvedNativeLibrary): l is ResolvedNativeLibrary =>
      "extractExclude" in l;
    for (const lib of all) {
      const valid = await this.artifactValid(lib.artifact.file, lib.artifact.sha1, lib.artifact.size);
      if (!valid) {
        if (isNative(lib)) badNatives.push(lib);
        else badClass.push(lib);
      }
      done += 1;
      this.progress(instanceId, "libraries", done, all.length);
    }

    let redownloaded = 0;
    if (badClass.length > 0 || badNatives.length > 0) {
      this.logger.warn(
        { classes: badClass.length, natives: badNatives.length },
        "corrupt artifacts found; redownloading",
      );
      // remove corrupt finals so downloads restart cleanly
      for (const f of [...badClass.map((l) => l.artifact.file), ...badNatives.map((l) => l.artifact.file)]) {
        fs.rmSync(f, { force: true });
        fs.rmSync(`${f}.part`, { force: true });
      }
      redownloaded = badClass.length + badNatives.length;
      if (badClass.length > 0) await this.downloads.ensureLibraries(badClass);
      if (badNatives.length > 0) await this.downloads.ensureNativeJars(badNatives);
    }

    // ---- assets
    const index = resolved.assetIndex ? await this.downloads.ensureAssetIndex(resolved) : null;
    let corruptRemoved = 0;
    if (index !== null && opts?.deepAssets === true) {
      this.progress(instanceId, "assets-audit", 0, 1);
      corruptRemoved = await this.assets.deepVerifyAndPrune(index);
      this.progress(instanceId, "assets-audit", 1, 1);
    }
    this.progress(instanceId, "assets", 0, 1);
    if (index !== null) {
      await this.downloads.ensureAssets(index, resolved.assetIndex!.id);
    }
    this.progress(instanceId, "assets", 1, 1);

    // ---- natives extraction (idempotent)
    this.progress(instanceId, "natives", 0, 1);
    await this.downloads.extractNatives(resolution.natives, nativesDir);
    this.progress(instanceId, "natives", 1, 1);

    return {
      instanceId,
      versionId: resolved.id,
      checked: {
        client: clientOk,
        libraries: resolution.classpath.length,
        libraryFailures: badClass.length,
        nativeJars: resolution.natives.length,
        assetObjects: Object.keys(index?.objects ?? {}).length,
        corruptAssetsRemoved: corruptRemoved,
      },
      redownloadedLibraries: redownloaded,
    };
  }

  private async artifactValid(file: string, sha1?: string, size?: number): Promise<boolean> {
    try {
      const st = fs.statSync(file);
      if (!st.isFile()) return false;
      if (size !== undefined && st.size !== size) return false;
      if (sha1 === undefined || sha1.length === 0) return true;
      return (await sha1File(file)).toLowerCase() === sha1.toLowerCase();
    } catch {
      return false;
    }
  }

  private progress(instanceId: string, stage: string, current: number, total: number): void {
    const payload: RepairProgressPayload = { instanceId, stage, current, total };
    this.bus.publish(Events.REPAIR_PROGRESS, payload, instanceId);
  }

  private versionIdFor(instance: {
    minecraftVersion: string;
    loader: string;
    loaderVersion: string | null;
  }): string {
    if (instance.loader !== "vanilla" && instance.loaderVersion) {
      // Each loader has its own version-id scheme (and Forge changed its scheme
      // across Minecraft versions), so ask the adapter for all plausible ids and
      // pick the one that is actually installed locally.
      const adapter = this.loaders.get(instance.loader);
      if (adapter) {
        const candidates = adapter.versionIdCandidates(instance.minecraftVersion, instance.loaderVersion);
        const installed = candidates.find((id) => this.versions.hasLocal(id));
        if (!installed) {
          throw new AppError(
            "VERSION_NOT_FOUND",
            `Mod loader ${instance.loader} ${instance.loaderVersion} is not installed. Please install it before repairing.`,
            404,
          );
        }
        return installed;
      }
      return `${instance.loader}-${instance.loaderVersion}-${instance.minecraftVersion}`;
    }
    return instance.minecraftVersion;
  }
}
