import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { AppConfig } from "../../config/env.js";
import { Logger } from "../../config/logger.js";
import { Database } from "../../infrastructure/database/database.js";
import { EventBus, Events } from "../../websocket/events.js";
import { InstanceService } from "../../services/instance-service.js";
import { ValidationError } from "../../errors/index.js";
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
export class ContentManager {
  constructor(
    private readonly config: AppConfig,
    private readonly db: Database,
    private readonly instances: InstanceService,
    private readonly bus: EventBus,
    private readonly logger: Logger,
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