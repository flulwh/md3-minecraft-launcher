import { z } from "zod";
import { CachedFetcher } from "../../infrastructure/cache/cache.js";
import { Logger } from "../../config/logger.js";
import { manifestSources, MirrorMode } from "../../infrastructure/mirror/mirrors.js";
import type { SettingsService } from "../../services/settings-service.js";

const manifestSchema = z.object({
  latest: z.object({
    release: z.string(),
    snapshot: z.string(),
  }),
  versions: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      url: z.string().url(),
      time: z.string(),
      releaseTime: z.string(),
      sha1: z.string(),
      complianceLevel: z.number().optional(),
    }),
  ),
});

export interface ManifestVersion {
  id: string;
  type: string;
  url: string;
  time: string;
  releaseTime: string;
  sha1: string;
  complianceLevel?: number;
}

export interface VersionManifest {
  latest: { release: string; snapshot: string };
  versions: ManifestVersion[];
}

export class VersionManifestService {
  private readonly fallbackMode: MirrorMode;

  constructor(
    private readonly cachedFetcher: CachedFetcher,
    private readonly logger: Logger,
    mode: MirrorMode = "auto",
    private readonly settings?: SettingsService,
  ) {
    this.fallbackMode = mode;
  }

  private async getMirrorMode(): Promise<MirrorMode> {
    if (this.settings) return this.settings.getMirrorMode();
    return this.fallbackMode;
  }

  /** Public accessor so dependent services (e.g. version.json fetching) can build mirror candidates. */
  async currentMirrorMode(): Promise<MirrorMode> {
    return this.getMirrorMode();
  }

  // Shared key that always holds the last known-good manifest, so a switch to
  // an unreachable mirror falls back to cached data instead of a blank list.
  private static readonly FALLBACK_KEY = "manifest:v2";

  async getManifest(): Promise<VersionManifest> {
    const mode = await this.getMirrorMode();
    let lastError: unknown;
    for (const url of manifestSources(mode)) {
      const key = `manifest:v2:${url}`;
      try {
        const { data } = await this.cachedFetcher.getJsonWithCache<unknown>(url, key, {
          memoryTtlMs: 5 * 60_000,
          validate: (raw) => manifestSchema.safeParse(raw).success,
        });
        // Keep the shared copy fresh for cross-mirror fallback.
        this.cachedFetcher.writeDisk(
          VersionManifestService.FALLBACK_KEY,
          data as VersionManifest,
        );
        return data as VersionManifest;
      } catch (err) {
        lastError = err;
        this.logger.debug({ err, url }, "manifest source failed");
      }
    }
    // The active mirror is unreachable and has no cache of its own — fall back
    // to the last known-good manifest so the version list is not empty.
    const stale = this.cachedFetcher.getFromDisk<VersionManifest>(
      VersionManifestService.FALLBACK_KEY,
    );
    if (stale) return stale;
    throw lastError instanceof Error ? lastError : new Error("Unable to load version manifest");
  }

  async findVersion(id: string): Promise<ManifestVersion | undefined> {
    const manifest = await this.getManifest();
    return manifest.versions.find((v) => v.id === id);
  }

  async listVersions(filter?: { type?: string; limit?: number; offset?: number }): Promise<{
    latest: { release: string; snapshot: string };
    total: number;
    versions: ManifestVersion[];
  }> {
    const manifest = await this.getManifest();
    let versions = manifest.versions;
    if (filter?.type && filter.type !== "all") {
      versions = versions.filter((v) => v.type === filter.type);
    }
    const total = versions.length;
    const offset = filter?.offset ?? 0;
    const limit = Math.min(filter?.limit ?? 100, 2000);
    return {
      latest: manifest.latest,
      total,
      versions: versions.slice(offset, offset + limit),
    };
  }
}
