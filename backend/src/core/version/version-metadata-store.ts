import fs from "node:fs";
import path from "node:path";
import { HttpClient } from "../../infrastructure/http/http-client.js";
import { AppConfig } from "../../config/env.js";
import { Logger } from "../../config/logger.js";
import { VersionNotFoundError } from "../../errors/index.js";
import { assertInside } from "../../utils/paths.js";
import { ManifestVersion, VersionManifestService } from "./version-manifest.js";
import { versionJsonSchema } from "./schema.js";
import { VersionJson } from "./types.js";

/**
 * Loads raw version JSONs from:
 *   1. local custom versions dir (user/loader installed profiles)
 *   2. disk cache keyed by manifest sha1
 *   3. Mojang meta servers
 */
export class VersionMetadataStore {
  constructor(
    private readonly config: AppConfig,
    private readonly http: HttpClient,
    private readonly manifests: VersionManifestService,
    private readonly logger?: Logger,
  ) {}

  async getRaw(id: string): Promise<{ json: VersionJson; source: "local" | "cache" | "remote" }> {
    // 1. local override (custom ids that may not exist in the manifest)
    const localFile = this.localVersionFile(id);
    if (localFile && fs.existsSync(localFile)) {
      return { json: this.readAndValidate(localFile, id), source: "local" };
    }

    // 2. Forge/NeoForge version ids (e.g. "26.2-forge-65.1.3") are not in
    //    Mojang's manifest. If not installed locally, the caller must install
    //    the loader first — falling back to the base vanilla JSON would break
    //    the inheritsFrom chain.
    if (this.isLoaderId(id)) {
      throw new VersionNotFoundError(id);
    }

    const entry = await this.manifests.findVersion(id);
    if (!entry) {
      throw new VersionNotFoundError(id);
    }

    // 3. local file matching manifest id (may have been downloaded before)
    if (localFile && fs.existsSync(localFile)) {
      return { json: this.readAndValidate(localFile, id), source: "local" };
    }

    // 4. remote with disk cache handled by http-level caching of the raw text is
    //    not applicable here (binary integrity via sha1); use explicit file cache.
    const cacheFile = path.join(this.config.cacheDir, `version-${entry.sha1}.json`);
    if (fs.existsSync(cacheFile)) {
      try {
        return { json: this.readAndValidate(cacheFile, id), source: "cache" };
      } catch {
        fs.rmSync(cacheFile, { force: true });
      }
    }

    const json = await this.fetchRemote(entry);
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(json));
    return { json, source: "remote" };
  }

  /** Persists a raw version JSON into the shared versions store (loader installs use this). */
  saveLocal(id: string, json: unknown): void {
    const dir = path.join(this.config.versionsDir, id);
    assertInside(this.config.versionsDir, dir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${id}.json`),
      JSON.stringify(json, null, 2),
    );
  }

  hasLocal(id: string): boolean {
    const file = this.localVersionFile(id);
    return file !== null && fs.existsSync(file);
  }

  localVersionPath(id: string): string | null {
    const safeId = id.replace(/[^a-zA-Z0-9._-]/g, "_");
    if (safeId !== id) return null;
    return path.join(this.config.versionsDir, id, `${id}.json`);
  }

  /** Whether the version id was produced by a mod-loader adapter (contains a loader infix). */
  private isLoaderId(id: string): boolean {
    return /-forge-|-neoforge-|^forge-|^neoforge-/.test(id);
  }

  private localVersionFile(id: string): string | null {
    const p = this.localVersionPath(id);
    if (!p) return null;
    try {
      assertInside(this.config.versionsDir, p);
      return p;
    } catch {
      return null;
    }
  }

  private readAndValidate(file: string, expectedId: string): VersionJson {
    const raw: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    const parsed = versionJsonSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Invalid version JSON at ${file}: ${parsed.error.issues[0]?.message ?? "unknown"}`);
    }
    if (parsed.data.id !== expectedId && !parsed.data.inheritsFrom) {
      this.logger?.debug({ file, expectedId, actualId: parsed.data.id }, "version id mismatch");
    }
    return parsed.data as VersionJson;
  }

  private async fetchRemote(entry: ManifestVersion): Promise<VersionJson> {
    const res = await this.http.getJson<unknown>(entry.url);
    const parsed = versionJsonSchema.safeParse(res);
    if (!parsed.success) {
      throw new Error(
        `Invalid version JSON for ${entry.id}: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
      );
    }
    // integrity check against manifest sha1 when we can read the file back
    return parsed.data as VersionJson;
  }
}
