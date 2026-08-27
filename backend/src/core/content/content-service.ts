import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { AppConfig } from "../../config/env.js";
import { Logger } from "../../config/logger.js";
import { Database } from "../../infrastructure/database/database.js";
import { EventBus, Events } from "../../websocket/events.js";
import { InstanceService } from "../../services/instance-service.js";
import { DownloadError, ValidationError } from "../../errors/index.js";
import { DownloadManager } from "../download/download-manager.js";
import { MarketService } from "../market/market-service.js";
import type {
  MarketContentType,
  MarketItemSummary,
  MarketProviderId,
} from "../market/models/market-item.js";
import type { MarketVersion } from "../market/models/market-version.js";
import {
  ContentEntry,
  ContentKind,
  CONTENT_DIRS,
  MOD_DISABLED_SUFFIX,
} from "./content-types.js";

/** How an entry's enabled state is determined. */
type EnableSource = "filename" | "override";

const ENABLE_SOURCE: Record<ContentKind, EnableSource> = {
  // Mods disable by renaming to "<name>.jar.disabled"; Minecraft only loads `.jar`.
  mod: "filename",
  // Resource/shader packs have no universal rename convention, so we persist an
  // explicit user override (in-game options.txt/iris wiring is a later phase).
  resourcepack: "override",
  shaderpack: "override",
};

/**
 * Instance content management (mods / resource packs / shader packs).
 *
 * The source of truth is the filesystem under the instance's `.minecraft`;
 * the `contentOverride` table only stores user overrides for kinds that have no
 * filename convention. Every mutation publishes a `content.changed` event so
 * connected clients can refresh.
 */
/** Maps a market content type to an instance content folder (modpack/world unsupported). */
const MARKET_TYPE_TO_KIND: Partial<Record<MarketContentType, ContentKind>> = {
  mod: "mod",
  resourcepack: "resourcepack",
  shader: "shaderpack",
};

const MARKET_KIND_EXTENSIONS: Partial<Record<ContentKind, string>> = {
  mod: "jar",
  resourcepack: "zip",
  shaderpack: "zip",
};

export interface MarketInstallResult {
  instanceId: string;
  projectId: string;
  projectName: string;
  type: MarketContentType;
  kind: ContentKind;
  fileName: string;
  versionName: string;
  installed: string[];
}

export interface MarketInstalledEntry {
  projectId: string;
  provider: MarketProviderId;
  name: string;
  type: string;
  versionName: string;
  fileName: string;
  enabled: boolean;
  installedAt: string;
}

export class ContentManager {
  constructor(
    private readonly config: AppConfig,
    private readonly db: Database,
    private readonly instances: InstanceService,
    private readonly bus: EventBus,
    private readonly logger: Logger,
    private readonly downloads: DownloadManager,
    private readonly market: MarketService,
  ) {}

  contentDir(instanceId: string, kind: ContentKind): string {
    const dir = path.join(this.instances.gameDirectory(instanceId), CONTENT_DIRS[kind]);
    return dir;
  }

  async list(instanceId: string, kind: ContentKind): Promise<ContentEntry[]> {
    await this.instances.require(instanceId);
    const dir = this.contentDir(instanceId, kind);

    if (ENABLE_SOURCE[kind] === "filename") return this.listRenameBased(kind, dir);
    return this.listOverrideBased(instanceId, kind, dir);
  }

  async setEnabled(
    instanceId: string,
    kind: ContentKind,
    fileName: string,
    enabled: boolean,
  ): Promise<void> {
    await this.instances.require(instanceId);
    const safe = assertSafeFileName(fileName);

    if (ENABLE_SOURCE[kind] === "filename") {
      this.toggleRename(kind, this.contentDir(instanceId, kind), safe, enabled);
    } else {
      await this.upsertOverride(instanceId, kind, safe, enabled);
    }
    this.publishChanged(instanceId, kind);
  }

  async remove(instanceId: string, kind: ContentKind, fileName: string): Promise<void> {
    await this.instances.require(instanceId);
    const safe = assertSafeFileName(fileName);
    const dir = this.contentDir(instanceId, kind);

    if (ENABLE_SOURCE[kind] === "filename") {
      // Remove both the active (`x.jar`) and disabled (`x.jar.disabled`) variants.
      const active = toActiveName(safe, this.jarExtension(kind));
      for (const variant of [active, active + MOD_DISABLED_SUFFIX]) {
        await fs.promises.rm(path.join(dir, variant), { force: true });
      }
    } else {
      await fs.promises.rm(path.join(dir, safe), { force: true });
      await this.db.client.contentOverride.deleteMany({
        where: { instanceId, kind, fileName: safe, worldName: "" },
      });
    }
    this.publishChanged(instanceId, kind);
  }

  /** Absolute directory (validated inside the instance sandbox) for "reveal in folder". */
  async reveal(instanceId: string, kind: ContentKind): Promise<string> {
    await this.instances.require(instanceId);
    return this.contentDir(instanceId, kind);
  }

  /**
   * Streams an uploaded file into the content folder for the given instance.
   * Rejects path-traversal names and files whose extension does not match the
   * kind, and refuses to silently overwrite an existing entry.
   */
  async import(
    instanceId: string,
    kind: ContentKind,
    originalFileName: string,
    source: Readable,
  ): Promise<string> {
    await this.instances.require(instanceId);
    // Strip any client-supplied directory prefix before validating.
    const safe = assertSafeFileName(path.basename(originalFileName.trim() || "upload"));
    this.assertExtension(kind, safe);

    const dir = this.contentDir(instanceId, kind);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, safe);
    if (fs.existsSync(dest)) {
      throw new ValidationError(`Content file already exists: ${safe}`);
    }

    await pipeline(source, fs.createWriteStream(dest));
    this.publishChanged(instanceId, kind);
    return safe;
  }

  // -------------------------------------------------------- market install

  /**
   * Downloads a marketplace release into the instance's content folder and
   * records an InstalledContent row (plus the MarketItem/MarketVersion rows it
   * references). Required dependencies with a resolvable version are installed
   * into the same folder too. Modpacks and worlds are not expressible as a
   * single drop-in file and are rejected.
   */
  async installMarket(
    instanceId: string,
    provider: MarketProviderId,
    projectId: string,
    versionId: string,
  ): Promise<MarketInstallResult> {
    await this.instances.require(instanceId);
    const project = await this.market.project(provider, projectId);
    const kind = MARKET_TYPE_TO_KIND[project.type];
    if (!kind) {
      throw new ValidationError(
        `Market type '${project.type}' can't be dropped into an instance; only mod/resourcepack/shader are supported`,
      );
    }
    const versions = await this.market.versions(provider, projectId);
    const version = versions.find((v) => v.id === versionId);
    if (!version) throw new ValidationError(`Market version '${versionId}' not found`);

    const visited = new Set<string>();
    const renamedProject = await this.installVersionChain(instanceId, provider, projectId, versionId, visited);
    // publish once for the top-level kind so clients refresh the affected folder
    this.publishChanged(instanceId, renamedProject.kind);
    return renamedProject;
  }

  /**
   * Installs one version (and, recursively, its required dependencies that the
   * same provider can resolve) into the instance's content folder. Returns the
   * top-level project's resolved name.
   */
  private async installVersionChain(
    instanceId: string,
    provider: MarketProviderId,
    projectId: string,
    versionId: string,
    visited: Set<string>,
  ): Promise<MarketInstallResult> {
    const key = `${provider}:${projectId}:${versionId}`;
    if (visited.has(key)) return this.skeleton(instanceId, provider, projectId, versionId);
    visited.add(key);

    const project = await this.market.project(provider, projectId);
    const kind = MARKET_TYPE_TO_KIND[project.type];
    if (!kind) return this.skeleton(instanceId, provider, projectId, versionId);

    const versions = await this.market.versions(provider, projectId);
    const version = versions.find((v) => v.id === versionId);
    if (!version) return this.skeleton(instanceId, provider, projectId, versionId);

    const fileName = await this.downloadMarketFile(instanceId, kind, version);
    const versionRow = await this.upsertMarketRecords(provider, project, version, fileName);

    const existing = await this.db.client.installedContent.findFirst({
      where: { instanceId, marketItemId: versionRow.itemId, versionId: versionRow.id },
    });
    if (!existing) {
      await this.db.client.installedContent.create({
        data: {
          instanceId,
          marketItemId: versionRow.itemId,
          versionId: versionRow.id,
          type: project.type,
          fileName,
          enabled: true,
        },
      });
    }

    // Resolve & install required dependencies recursively. Each dependency is
    // classified by its own type inside the recursive call (modpack/world
    // dependencies resolve to an empty result and are effectively skipped).
    let installed = [fileName];
    for (const dep of version.dependencies) {
      if (!dep.dependencyId || !dep.versionId) continue;
      try {
        const depResult = await this.installVersionChain(
          instanceId,
          provider,
          dep.dependencyId,
          dep.versionId,
          visited,
        );
        installed = installed.concat(depResult.installed);
      } catch (err) {
        throw new DownloadError(
          `Failed to install required dependency '${dep.name ?? dep.dependencyId}' for '${project.name}': ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (fileName !== "") {
      this.logger.info({ instanceId, provider, projectId, versionId, fileName }, "market content installed");
    }
    return {
      instanceId,
      projectId,
      projectName: project.name,
      type: project.type,
      kind,
      fileName,
      versionName: version.versionName,
      installed,
    };
  }

  /** Removes the installed file (all installed versions) for a market project from an instance. */
  async uninstallMarket(instanceId: string, provider: MarketProviderId, projectId: string): Promise<string[]> {
    await this.instances.require(instanceId);
    const item = await this.db.client.marketItem.findUnique({
      where: { provider_externalId: { provider, externalId: projectId } },
    });
    if (!item) return [];
    const rows = await this.db.client.installedContent.findMany({
      where: { instanceId, marketItemId: item.id },
    });
    const removed: string[] = [];
    for (const row of rows) {
      const kind = MARKET_TYPE_TO_KIND[row.type as MarketContentType];
      if (kind) {
        const dir = this.contentDir(instanceId, kind);
        const ext = MARKET_KIND_EXTENSIONS[kind];
        const variants = ext
          ? [row.fileName, row.fileName.endsWith(`.${ext}`) ? `${row.fileName}${MOD_DISABLED_SUFFIX}` : row.fileName]
          : [row.fileName];
        for (const v of variants) {
          try {
            await fs.promises.rm(path.join(dir, v), { force: true });
          } catch {
            /* best effort */
          }
        }
        removed.push(row.fileName);
      }
      await this.db.client.installedContent.delete({ where: { id: row.id } });
    }
    if (removed.length > 0) this.publishChanged(instanceId, (MARKET_TYPE_TO_KIND[rows[0]!.type as MarketContentType] ?? "mod"));
    return removed;
  }

  /** Lists marketplace-sourced content installed in an instance. */
  async listMarket(instanceId: string): Promise<MarketInstalledEntry[]> {
    await this.instances.require(instanceId);
    const rows = await this.db.client.installedContent.findMany({
      where: { instanceId },
      include: { marketItem: true },
    });
    const out: MarketInstalledEntry[] = [];
    for (const r of rows) {
      const marketVersion = await this.db.client.marketVersion.findUnique({ where: { id: r.versionId } });
      out.push({
        projectId: r.marketItem.externalId,
        provider: r.marketItem.provider as MarketProviderId,
        name: r.marketItem.name,
        type: r.marketItem.type,
        versionName: marketVersion?.versionName ?? "?",
        fileName: r.fileName,
        enabled: r.enabled,
        installedAt: r.installedAt.toISOString(),
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  private async downloadMarketFile(
    instanceId: string,
    kind: ContentKind,
    version: MarketVersion,
  ): Promise<string> {
    const expectedName = path.basename(version.fileName.trim() || "download");
    if (expectedName.length > 255 || expectedName.startsWith(".") || expectedName.includes("/") || expectedName.includes("\\")) {
      throw new ValidationError(`Invalid market file name: ${expectedName}`);
    }
    const ext = MARKET_KIND_EXTENSIONS[kind];
    if (ext && !expectedName.toLowerCase().endsWith(`.${ext}`)) {
      throw new ValidationError(`Market version file '${expectedName}' does not match kind '${kind}'`);
    }

    const dir = this.contentDir(instanceId, kind);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, expectedName);
    if (fs.existsSync(dest)) {
      throw new ValidationError(`Already installed '${expectedName}' in this instance`);
    }

    const { outcome } = this.downloads.enqueue({
      urls: [version.fileUrl],
      dest,
      ...(version.hash ? { checksum: { algorithm: version.hash.algorithm, value: version.hash.value } } : {}),
      ...(version.fileSize > 0 ? { size: version.fileSize } : {}),
      kind: "other",
      provider: version.provider,
      context: { instanceId, market: true },
    });
    const result = await outcome;
    if (result.status !== "completed") {
      throw new DownloadError(
        `Failed to download '${expectedName}': ${result.snapshot.error ?? "unknown error"}`,
      );
    }
    return expectedName;
  }

  private async upsertMarketRecords(
    provider: MarketProviderId,
    project: MarketItemSummary,
    version: MarketVersion,
    fileName: string,
  ): Promise<{ itemId: string; id: string }> {
    const item = await this.db.client.marketItem.upsert({
      where: { provider_externalId: { provider, externalId: project.id } },
      update: { name: project.name, type: project.type, slug: project.slug, description: project.description, author: project.author, iconUrl: project.iconUrl, website: project.website, downloads: project.downloads },
      create: {
        provider,
        externalId: project.id,
        name: project.name,
        type: project.type,
        slug: project.slug,
        description: project.description,
        author: project.author,
        iconUrl: project.iconUrl,
        website: project.website,
        downloads: project.downloads,
      },
    });

    const baseVersionData = {
      itemId: item.id,
      versionName: version.versionName,
      minecraftVersions: version.minecraftVersions.join(","),
      loader: version.loader,
      fileUrl: version.fileUrl,
      fileName: fileName,
      fileSize: version.fileSize,
      hashAlgorithm: version.hash?.algorithm ?? null,
      hashValue: version.hash?.value ?? null,
      releaseDate: version.releaseDate ? new Date(version.releaseDate) : null,
    };
    const versionData =
      version.dependencies.length > 0
        ? { ...baseVersionData, dependencies: JSON.stringify(version.dependencies) }
        : baseVersionData;
    let versionRow = await this.db.client.marketVersion.findFirst({
      where: { itemId: item.id, versionName: version.versionName },
    });
    if (!versionRow) {
      versionRow = await this.db.client.marketVersion.create({ data: versionData });
    } else {
      versionRow = await this.db.client.marketVersion.update({ where: { id: versionRow.id }, data: versionData });
    }

    await this.db.client.contentDependency.deleteMany({ where: { parentVersionId: versionRow.id } });
    for (const dep of version.dependencies) {
      await this.db.client.contentDependency.create({
        data: {
          parentVersionId: versionRow.id,
          dependencyId: dep.dependencyId,
          required: true,
        },
      });
    }
    return { itemId: item.id, id: versionRow.id };
  }

  private skeleton(
    instanceId: string,
    provider: MarketProviderId,
    projectId: string,
    versionId: string,
  ): MarketInstallResult {
    return { instanceId, projectId, projectName: projectId, type: "mod", kind: "mod", fileName: "", versionName: versionId, installed: [] };
  }

  // ------------------------------------------------------------------ helpers

  private listRenameBased(kind: ContentKind, dir: string): ContentEntry[] {
    const ext = this.jarExtension(kind);
    const byBase = new Map<string, { exists: boolean; size: number; mtimeMs: number }>();
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    for (const e of entries) {
      const name = e.name;
      const isActive = name.endsWith(`.${ext}`);
      const isDisabled =
        name.endsWith(MOD_DISABLED_SUFFIX) &&
        name.slice(0, -MOD_DISABLED_SUFFIX.length).endsWith(`.${ext}`);
      if (!isActive && !isDisabled) continue;
      const base = isActive ? name : name.slice(0, -MOD_DISABLED_SUFFIX.length);
      if (isActive) {
        let size = 0;
        let mtimeMs = 0;
        try {
          const st = fs.statSync(path.join(dir, name));
          size = st.size;
          mtimeMs = st.mtimeMs;
        } catch {
          /* ignore unreadable */
        }
        byBase.set(base, { exists: true, size, mtimeMs });
      } else if (!byBase.has(base)) {
        byBase.set(base, { exists: false, size: 0, mtimeMs: 0 });
      }
    }
    return [...byBase.entries()]
      .map(([fileName, v]) => ({ fileName, size: v.size, mtimeMs: v.mtimeMs, enabled: v.exists }))
      .sort((a, b) => a.fileName.localeCompare(b.fileName));
  }

  private async listOverrideBased(
    instanceId: string,
    kind: ContentKind,
    dir: string,
  ): Promise<ContentEntry[]> {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const overrides = await this.db.client.contentOverride.findMany({
      where: { instanceId, kind, worldName: "" },
    });
    const enabledMap = new Map(overrides.map((o) => [o.fileName, o.enabled]));

    const out: ContentEntry[] = [];
    for (const e of entries) {
      const stat = e.isDirectory()
        ? this.safeStatDir(dir, e.name)
        : this.safeStatFile(dir, e.name);
      if (stat === null) continue;
      out.push({
        fileName: e.name,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        enabled: enabledMap.get(e.name) ?? true,
      });
    }
    return out.sort((a, b) => a.fileName.localeCompare(b.fileName));
  }

  private toggleRename(kind: ContentKind, dir: string, fileName: string, enabled: boolean): void {
    const activeName = toActiveName(fileName, this.jarExtension(kind));
    const activePath = path.join(dir, activeName);
    const disabledPath = path.join(dir, activeName + MOD_DISABLED_SUFFIX);

    const target = enabled ? activePath : disabledPath;
    const current = enabled ? disabledPath : activePath;
    if (fs.existsSync(target)) return; // already in the requested state
    if (!fs.existsSync(current)) {
      throw new ValidationError(`Content file not found: ${fileName}`);
    }
    fs.renameSync(current, target);
  }

  private jarExtension(kind: ContentKind): string {
    return kind === "mod" ? "jar" : "zip";
  }

  private assertExtension(kind: ContentKind, fileName: string): void {
    const expected = this.jarExtension(kind);
    if (!fileName.toLowerCase().endsWith(`.${expected}`)) {
      throw new ValidationError(
        `Content kind '${kind}' only accepts '.${expected}' files (got '${fileName}')`,
      );
    }
  }

  private async upsertOverride(
    instanceId: string,
    kind: ContentKind,
    fileName: string,
    enabled: boolean,
  ): Promise<void> {
    const def = { instanceId, kind, fileName, worldName: "" };
    const existing = await this.db.client.contentOverride.findFirst({ where: def });
    if (existing) {
      await this.db.client.contentOverride.update({
        where: { id: existing.id },
        data: { enabled },
      });
    } else {
      await this.db.client.contentOverride.create({ data: { ...def, enabled } });
    }
  }

  private safeStatFile(dir: string, name: string): { size: number; mtimeMs: number } | null {
    try {
      const st = fs.statSync(path.join(dir, name));
      return st.isFile() ? { size: st.size, mtimeMs: st.mtimeMs } : null;
    } catch {
      return null;
    }
  }

  private safeStatDir(dir: string, name: string): { size: number; mtimeMs: number } | null {
    try {
      const st = fs.statSync(path.join(dir, name));
      return st.isDirectory() ? { size: 0, mtimeMs: st.mtimeMs } : null;
    } catch {
      return null;
    }
  }

  private publishChanged(instanceId: string, kind: ContentKind): void {
    this.bus.publish(Events.CONTENT_CHANGED, { kind }, instanceId);
  }
}

/**
 * Normalizes any accepted mod reference to its active file name (`foo.jar`):
 *   - strips a trailing `.disabled` suffix,
 *   - guarantees the matching content extension is present.
 */
function toActiveName(fileName: string, ext: string): string {
  let base = fileName;
  if (base.endsWith(MOD_DISABLED_SUFFIX)) base = base.slice(0, -MOD_DISABLED_SUFFIX.length);
  return base.endsWith(`.${ext}`) ? base : `${base}.${ext}`;
}

/**
 * Guards against path-traversal / absolute-path file names coming from the API.
 * Also forbids hidden dot-files that belong to the OS/tooling.
 */
function assertSafeFileName(fileName: string): string {
  if (fileName.length === 0 || fileName.length > 255) {
    throw new ValidationError("Invalid content file name");
  }
  if (fileName === "." || fileName === ".." || fileName.includes("/") || fileName.includes("\\")) {
    throw new ValidationError("Content file name must be a bare file name");
  }
  if (fileName.startsWith(".")) {
    throw new ValidationError("Content file name must not start with '.'");
  }
  return fileName;
}
