import {
  AssetIndexMeta,
  Library,
  ResolvedVersion,
  VersionJson,
} from "../core/version/types.js";
import { VersionManifestService } from "../core/version/version-manifest.js";
import { VersionResolver } from "../core/version/version-resolver.js";
import { VersionMetadataStore } from "../core/version/version-metadata-store.js";
import { Logger } from "../config/logger.js";

export interface VersionSummary {
  id: string;
  type: string;
  mainClass: string;
  inheritanceChain: string[];
  libraryCount: number;
  hasAssetIndex: boolean;
  assets?: string;
  javaVersion?: { component: string; majorVersion: number };
  clientSize?: number;
}

/**
 * Facade unifying manifest listing, metadata access and inheritance-aware
 * resolution for the API layer.
 */
export class VersionService {
  constructor(
    private readonly manifests: VersionManifestService,
    private readonly resolver: VersionResolver,
    private readonly store: VersionMetadataStore,
    private readonly logger: Logger,
  ) {}

  async list(filter?: { type?: string; limit?: number; offset?: number }) {
    return this.manifests.listVersions(filter);
  }

  async latest(): Promise<{ release: string; snapshot: string }> {
    const manifest = await this.manifests.getManifest();
    return manifest.latest;
  }

  /** Fully resolves inheritance and returns a normalized summary. */
  async describe(versionId: string): Promise<VersionSummary> {
    const resolved = await this.resolver.resolve(versionId);
    return this.toSummary(resolved);
  }

  async resolve(versionId: string): Promise<ResolvedVersion> {
    return this.resolver.resolve(versionId);
  }

  /** Whether a version profile is present in the local versions store. */
  hasLocal(id: string): boolean {
    return this.store.hasLocal(id);
  }

  /** Raw (possibly inheriting) metadata for debugging/introspection. */
  async raw(versionId: string): Promise<VersionJson> {
    const { json } = await this.store.getRaw(versionId);
    return json;
  }

  /** Libraries applicable to the current platform (rules applied). */
  async librariesForPlatform(
    versionId: string,
    env: { os: string; arch: string },
  ): Promise<Library[]> {
    void env;
    const resolved = await this.resolve(versionId);
    return resolved.libraries;
  }

  assetIndexMeta(resolved: ResolvedVersion): AssetIndexMeta | null {
    return resolved.assetIndex ?? null;
  }

  private toSummary(resolved: ResolvedVersion): VersionSummary {
    return {
      id: resolved.id,
      type: resolved.type,
      mainClass: resolved.mainClass,
      inheritanceChain: resolved.inheritanceChain,
      libraryCount: resolved.libraries.length,
      hasAssetIndex: resolved.assetIndex !== undefined,
      ...(resolved.assets !== undefined ? { assets: resolved.assets } : {}),
      ...(resolved.javaVersion !== undefined ? { javaVersion: resolved.javaVersion } : {}),
      ...(resolved.downloads.client !== undefined
        ? { clientSize: resolved.downloads.client.size }
        : {}),
    };
  }
}
