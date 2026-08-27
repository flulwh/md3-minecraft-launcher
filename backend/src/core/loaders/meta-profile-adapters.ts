import fs from "node:fs";
import path from "node:path";
import { AppConfig } from "../../config/env.js";
import { Logger } from "../../config/logger.js";
import { HttpClient } from "../../infrastructure/http/http-client.js";
import { AppError } from "../../errors/index.js";
import { VersionMetadataStore } from "../version/version-metadata-store.js";
import { urlCandidates, MirrorMode } from "../../infrastructure/mirror/mirrors.js";
import type { SettingsService } from "../../services/settings-service.js";
import {
  LoaderVersion,
  ModLoaderAdapter,
} from "./mod-loader-adapter.js";

interface MetaProfileJson {
  id: string;
  inheritsFrom: string;
  [k: string]: unknown;
}

interface MetaLoaderEntry {
  loader?: { version?: string; stable?: boolean };
}

/**
 * Meta-driven adapter for loaders whose profile endpoint returns a complete
 * inheriting version JSON (Fabric & Quilt). No installer execution needed:
 * libraries resolve through the normal inheritance chain.
 */
abstract class MetaProfileAdapter implements ModLoaderAdapter {
  abstract readonly id: "fabric" | "quilt";
  abstract readonly displayName: string;
  protected abstract metaBase(): string;

  constructor(
    protected readonly config: AppConfig,
    protected readonly http: HttpClient,
    protected readonly store: VersionMetadataStore,
    protected readonly logger: Logger,
    private readonly mirrorSettings?: SettingsService,
  ) {}

  private async getMirrorMode(): Promise<MirrorMode> {
    if (this.mirrorSettings) return this.mirrorSettings.getMirrorMode();
    return "auto";
  }

  /** GET JSON from a canonical meta URL, falling back through mirror candidates. */
  private async fetchJson<T>(url: string): Promise<T> {
    const mode = await this.getMirrorMode();
    const candidates = urlCandidates(url, mode);
    let lastError: unknown;
    for (const candidate of candidates) {
      try {
        return await this.http.getJson<T>(candidate);
      } catch (err) {
        lastError = err;
        this.logger.debug({ url: candidate, err }, "meta mirror candidate failed");
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`No reachable meta source for ${url}`);
  }

  async getVersions(minecraftVersion: string): Promise<LoaderVersion[]> {
    const url = `${this.metaBase()}/versions/loader/${encodeURIComponent(minecraftVersion)}`;
    const entries = await this.fetchJson<MetaLoaderEntry[]>(url);
    return entries
      .map((e) => ({
        id: e.loader?.version ?? "",
        stable: e.loader?.stable ?? false,
      }))
      .filter((v) => v.id.length > 0);
  }

  /** Meta profiles follow `<loader>-loader-<loaderVersion>-<minecraftVersion>`. */
  versionId(minecraftVersion: string, loaderVersion: string): string {
    return `${this.id}-loader-${loaderVersion}-${minecraftVersion}`;
  }

  versionIdCandidates(minecraftVersion: string, loaderVersion: string): string[] {
    return [this.versionId(minecraftVersion, loaderVersion)];
  }

  async install(minecraftVersion: string, loaderVersion: string): Promise<string> {
    const url = `${this.metaBase()}/versions/loader/${encodeURIComponent(
      minecraftVersion,
    )}/${encodeURIComponent(loaderVersion)}/profile/json`;

    const profile = await this.fetchJson<MetaProfileJson>(url);
    if (!profile.id || !profile.inheritsFrom) {
      throw new AppError("LOADER_INSTALL_FAILED", `${this.displayName}: invalid profile response`);
    }
    this.store.saveLocal(profile.id, profile);
    this.logger.info({ loader: this.id, versionId: profile.id }, "loader profile installed");
    return profile.id;
  }

  async uninstall(versionId: string): Promise<void> {
    const file = this.store.localVersionPath(versionId);
    if (!file) throw new AppError("LOADER_INSTALL_FAILED", `Invalid version id '${versionId}'`);
    if (fs.existsSync(file)) fs.rmSync(file);
    const dir = path.dirname(file);
    try {
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    } catch {
      /* non-empty or gone */
    }
  }

  async validate(versionId: string): Promise<boolean> {
    const file = this.store.localVersionPath(versionId);
    return file !== null && fs.existsSync(file);
  }
}

export class FabricAdapter extends MetaProfileAdapter {
  readonly id = "fabric" as const;
  readonly displayName = "Fabric";

  protected metaBase(): string {
    return "https://meta.fabricmc.net/v2";
  }
}

export class QuiltAdapter extends MetaProfileAdapter {
  readonly id = "quilt" as const;
  readonly displayName = "Quilt";

  protected metaBase(): string {
    return "https://meta.quiltmc.org/v3";
  }
}
