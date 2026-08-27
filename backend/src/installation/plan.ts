import fs from "node:fs";
import { AppConfig } from "../config/env.js";
import { Logger } from "../config/logger.js";
import { VersionService } from "../services/version-service.js";
import { DownloadService } from "../services/download-service.js";
import { AssetService } from "../core/assets/asset-service.js";
import { LibraryResolver } from "../core/libraries/library-resolver.js";
import { LoaderRegistry } from "../core/loaders/loader-registry.js";
import { AppError } from "../errors/index.js";
import { currentRuntime } from "../utils/runtime-env.js";
import {
  InstallationPlan,
  InstallationPlanLoader,
  InstallationTask,
  InstallationTaskKind,
} from "./types.js";

/**
 * Resolves the concrete version id for an instance (vanilla id, or the loader's
 * generated id like `26.2-forge-65.1.3`). Lives here so both plan generation and
 * the orchestrator agree on the same id.
 */
export async function resolveInstallVersionId(
  loaders: LoaderRegistry,
  versions: VersionService,
  instance: { minecraftVersion: string; loader: string; loaderVersion: string | null },
): Promise<string> {
  if (instance.loader !== "vanilla" && instance.loaderVersion) {
    const adapter = loaders.get(instance.loader);
    if (adapter) {
      const candidates = adapter.versionIdCandidates(instance.minecraftVersion, instance.loaderVersion);
      const installed = candidates.find((id) => versions.hasLocal(id));
      if (!installed) {
        throw new AppError(
          "LOADER_NOT_INSTALLED",
          `Mod loader ${instance.loader} ${instance.loaderVersion} is not installed. Install it, or (re)run the installation to build it.`,
          409,
        );
      }
      return installed;
    }
    return `${instance.loader}-${instance.loaderVersion}-${instance.minecraftVersion}`;
  }
  return instance.minecraftVersion;
}

const KIND_PRIORITY: Record<InstallationTaskKind, number> = {
  CLIENT: 100,
  LOADER: 90,
  LIBRARY: 80,
  NATIVE: 70,
  ASSET_INDEX: 60,
  VERSION_JSON: 55,
  ASSET: 50,
};

function cachedValid(file: string, size?: number, sha1?: string): boolean {
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return false;
    if (size !== undefined && st.size !== size) return false;
    if (sha1 === undefined || sha1.length === 0) return true;
    // full SHA1 validation is deferred to the verify phase; size is the cheap gate
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds the pre-install plan: enumerates every file the instance needs, marks
 * which are already cached (existence + size gate), and totals the bytes that
 * still have to be downloaded. No bytes are fetched here (the asset index is
 * only read from its on-disk copy).
 */
export class InstallationPlanBuilder {
  private readonly resolver: LibraryResolver;

  constructor(
    private readonly config: AppConfig,
    private readonly versions: VersionService,
    private readonly downloads: DownloadService,
    private readonly assets: AssetService,
    private readonly loaders: LoaderRegistry,
    private readonly logger: Logger,
  ) {
    this.resolver = new LibraryResolver(config);
  }

  async build(
    instance: {
      id: string;
      minecraftVersion: string;
      loader: string;
      loaderVersion: string | null;
    },
  ): Promise<InstallationPlan> {
    void this.logger;
    const versionId = await resolveInstallVersionId(this.loaders, this.versions, instance);
    const resolved = await this.versions.resolve(versionId);
    const resolution = this.resolver.resolve(resolved.libraries, currentRuntime());

    const tasks: InstallationTask[] = [];

    // ---- client jar
    const clientJar = this.downloads.clientJarPath(resolved);
    const clientArtifact = resolved.downloads.client;
    tasks.push({
      id: clientJar,
      kind: "CLIENT",
      name: `${resolved.jarId}.jar`,
      path: clientJar,
      size: clientArtifact?.size ?? 0,
      sha1: clientArtifact?.sha1 ?? null,
      cached: cachedValid(clientJar, clientArtifact?.size, clientArtifact?.sha1),
      priority: KIND_PRIORITY.CLIENT,
    });

    // ---- libraries (class path) + natives
    for (const lib of resolution.classpath) {
      if (lib.artifact.producedLocally) continue; // loader-generated, not a download
      tasks.push({
        id: lib.artifact.file,
        kind: "LIBRARY",
        name: basename(lib.artifact.file),
        path: lib.artifact.file,
        size: lib.artifact.size ?? 0,
        sha1: lib.artifact.sha1 ?? null,
        cached: cachedValid(lib.artifact.file, lib.artifact.size, lib.artifact.sha1),
        priority: KIND_PRIORITY.LIBRARY,
      });
    }
    for (const native of resolution.natives) {
      tasks.push({
        id: native.artifact.file,
        kind: "NATIVE",
        name: basename(native.artifact.file),
        path: native.artifact.file,
        size: native.artifact.size ?? 0,
        sha1: native.artifact.sha1 ?? null,
        cached: cachedValid(native.artifact.file, native.artifact.size, native.artifact.sha1),
        priority: KIND_PRIORITY.NATIVE,
      });
    }

    // ---- asset index + assets
    const assetMeta = resolved.assetIndex;
    if (assetMeta) {
      const indexPath = this.assets.assetIndexPath(assetMeta.id);
      const indexCached = cachedValid(indexPath, assetMeta.size, assetMeta.sha1);
      tasks.push({
        id: indexPath,
        kind: "ASSET_INDEX",
        name: `${assetMeta.id}.json`,
        path: indexPath,
        size: assetMeta.size,
        sha1: assetMeta.sha1,
        cached: indexCached,
        priority: KIND_PRIORITY.ASSET_INDEX,
      });

      let assetTotal = assetMeta.totalSize ?? 0;
      let assetDone = 0;
      let assetPending = assetTotal > 0 ? 1 : 0;
      if (assetMeta.totalSize === undefined || assetMeta.totalSize === 0) assetPending = 0;
      if (indexCached) {
        try {
          const raw: unknown = JSON.parse(fs.readFileSync(indexPath, "utf8"));
          if (
            raw !== null &&
            typeof raw === "object" &&
            "objects" in raw &&
            typeof (raw as { objects: unknown }).objects === "object"
          ) {
            const content = raw as Parameters<AssetService["plan"]>[0];
            const planned = await this.assets.plan(content);
            assetTotal = planned.totalBytes;
            assetDone = planned.totalBytes - readyBytes(planned.requests);
            assetPending = planned.pendingDownloads;
          }
        } catch {
          /* fall back to metadata estimate */
        }
      }
      if (assetTotal > 0) {
        tasks.push({
          id: `assets:${assetMeta.id}`,
          kind: "ASSET",
          name: "Assets",
          path: this.config.assetsDir,
          size: assetTotal,
          cached: assetDone >= assetTotal || assetPending === 0,
          priority: KIND_PRIORITY.ASSET,
        });
      }
    }

    // ---- loader (Forge/NeoForge binary patch is one logical fileset step)
    if (instance.loader !== "vanilla") {
      tasks.push({
        id: `loader:${versionId}`,
        kind: "LOADER",
        name: instance.loader,
        path: versionId,
        size: 0,
        cached: false,
        priority: KIND_PRIORITY.LOADER,
      });
    }

    return this.summarize(instance, resolved.id, tasks);
  }

  private summarize(
    instance: { id: string; minecraftVersion: string; loader: string; loaderVersion: string | null },
    versionId: string,
    tasks: InstallationTask[],
  ): InstallationPlan {
    let totalBytes = 0;
    let cachedBytes = 0;
    let pendingFiles = 0;
    for (const t of tasks) {
      totalBytes += t.size;
      if (t.cached) cachedBytes += t.size;
      else pendingFiles += 1;
    }
    const loader: InstallationPlanLoader | undefined =
      instance.loader !== "vanilla" && instance.loaderVersion
        ? { type: instance.loader, version: instance.loaderVersion }
        : undefined;
    return {
      instanceId: instance.id,
      minecraft: instance.minecraftVersion,
      ...(loader ? { loader } : {}),
      versionId,
      files: tasks.length,
      pendingFiles,
      totalBytes,
      cachedBytes,
      downloadBytes: totalBytes - cachedBytes,
      tasks,
    };
  }
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

function readyBytes(requests: { size?: number }[]): number {
  let total = 0;
  for (const r of requests) total += r.size ?? 0;
  return total;
}