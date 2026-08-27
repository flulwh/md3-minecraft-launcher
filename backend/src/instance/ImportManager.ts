import fs from "node:fs";
import path from "node:path";
import { AppConfig } from "../config/env.js";
import { Logger } from "../config/logger.js";
import { EventBus, Events } from "../websocket/events.js";
import { InstanceService, InstanceDto } from "../services/instance-service.js";
import { ValidationError, AppError } from "../errors/index.js";
import { resolveInside } from "../utils/paths.js";

export interface ImportOptions {
  name?: string;
}

export interface ImportResult {
  instance: InstanceDto;
  format: "md3" | "mrpack";
  fileCount: number;
  /** mrpack packs carry overrides only; base game needs a follow-up install. */
  pendingInstall: boolean;
}

interface Md3Manifest {
  format: "md3-instance";
  version: number;
  name?: string;
  minecraftVersion?: string;
  loader?: string;
  loaderVersion?: string | null;
}

interface MrpackIndex {
  formatVersion?: number;
  versionId?: string;
  name?: string;
  loaders?: string[];
}

/**
 * Imports an exported MD3 instance pack (`.zip` with pack.json) or a Modrinth
 * `.mrpack` into a brand new instance.
 *
 * MD3 packs are fully self-contained → immediately READY.
 * Mrpack carriers only `overrides/` → instance is created CREATED so the
 * standard plan/install flow provisions the base Minecraft + loader, then a
 * follow-up /install applies the overrides.
 */
export class ImportManager {
  constructor(
    private readonly config: AppConfig,
    private readonly instances: InstanceService,
    private readonly bus: EventBus,
    private readonly logger: Logger,
  ) {}

  async importFrom(
    archivePath: string,
    originalName: string,
    opts: ImportOptions = {},
  ): Promise<ImportResult> {
    const AdmZip = (await import("adm-zip")).default;
    let zip: InstanceType<typeof AdmZip>;
    try {
      zip = new AdmZip(archivePath);
    } catch {
      throw new AppError("VALIDATION_ERROR", "无法打开的压缩包文件", 400);
    }
    const entries = zip.getEntries();
    const names = new Set(entries.map((e) => e.entryName.replace(/\\/g, "/")));

    const hasPack = names.has("pack.json") || names.has("./pack.json");
    const hasMrpackIndex = names.has("modrinth.index.json") || names.has("./modrinth.index.json");
    const isMrpack = originalName.toLowerCase().endsWith(".mrpack") || hasMrpackIndex;

    if (isMrpack && !hasPack) {
      return this.importMrpack(zip, entries, opts);
    }
    if (hasPack) {
      return this.importMd3(zip, entries, names, opts);
    }
    throw new ValidationError("无法识别的实例包格式（需要 MD3 包或 Modrinth .mrpack）");
  }

  private async importMd3(
    zip: InstanceType<any>,
    entries: ReturnType<InstanceType<any>["getEntries"]>,
    names: Set<string>,
    opts: ImportOptions,
  ): Promise<ImportResult> {
    const packEntry = zip.getEntry("pack.json") ?? zip.getEntry("./pack.json");
    let manifest: Md3Manifest;
    try {
      manifest = JSON.parse(packEntry.getData().toString("utf8")) as Md3Manifest;
    } catch {
      throw new ValidationError("实例包内 pack.json 损坏");
    }
    if (manifest.format !== "md3-instance") {
      throw new ValidationError("不是有效的 MD3 实例包");
    }

    const name = opts.name?.trim() || manifest.name || "导入的实例";
    const matched = await this.createFor(name, manifest.minecraftVersion || "", manifest.loader || "vanilla", manifest.loaderVersion);
    const instanceRoot = this.instanceRoot(matched.id);

    let fileCount = 0;
    for (const entry of entries) {
      const rel = entry.entryName.replace(/\\/g, "/").replace(/^(\.\/)+/, "");
      if (rel === "pack.json" || rel === "") continue;
      const safe = resolveInside(instanceRoot, rel);
      if (entry.isDirectory) {
        fs.mkdirSync(safe, { recursive: true });
        continue;
      }
      fileCount += 1;
      fs.mkdirSync(path.dirname(safe), { recursive: true });
      fs.writeFileSync(safe, entry.getData());
    }

    await this.instances.setStatus(matched.id, "READY", { installedAt: new Date() });
    this.publish(matched.id);
    return { instance: await this.instances.get(matched.id), format: "md3", fileCount, pendingInstall: false };
  }

  private async importMrpack(
    zip: InstanceType<any>,
    entries: ReturnType<InstanceType<any>["getEntries"]>,
    opts: ImportOptions,
  ): Promise<ImportResult> {
    const indexEntry = zip.getEntry("modrinth.index.json") ?? zip.getEntry("./modrinth.index.json");
    let index: MrpackIndex;
    try {
      index = JSON.parse(indexEntry.getData().toString("utf8")) as MrpackIndex;
    } catch {
      throw new ValidationError("mrpack 的 modrinth.index.json 损坏");
    }
    const loader = (index.loaders?.[0] ?? "vanilla").toLowerCase();
    const name = opts.name?.trim() || index.name || "导入的实例";
    const mc = index.versionId || "";
    const matched = await this.createFor(name, mc, normalizeLoader(loader), undefined);

    // mrpack `overrides/` mirrors the .minecraft layout — drop it into the game dir.
    const gameRoot = this.instances.gameDirectory(matched.id);
    fs.mkdirSync(gameRoot, { recursive: true });
    let fileCount = 0;
    for (const entry of entries) {
      const raw = entry.entryName.replace(/\\/g, "/").replace(/^(\.\/)+/, "");
      if (!raw.startsWith("overrides/") || raw === "overrides") continue;
      const rel = raw.replace(/^overrides\//, "");
      const safe = resolveInside(gameRoot, rel);
      if (entry.isDirectory) {
        fs.mkdirSync(safe, { recursive: true });
        continue;
      }
      fileCount += 1;
      fs.mkdirSync(path.dirname(safe), { recursive: true });
      fs.writeFileSync(safe, entry.getData());
    }

    this.publish(matched.id);
    return {
      instance: await this.instances.get(matched.id),
      format: "mrpack",
      fileCount,
      pendingInstall: true,
    };
  }

  private async createFor(
    name: string,
    minecraftVersion: string,
    loader: string,
    loaderVersion: string | null | undefined,
  ): Promise<InstanceDto> {
    return this.instances.create({
      name,
      minecraftVersion,
      loader: loader as never,
      ...(loaderVersion ? { loaderVersion } : {}),
    });
  }

  private instanceRoot(instanceId: string): string {
    const dir = path.join(this.config.instancesDir, instanceId);
    resolveInside(this.config.instancesDir, dir);
    return dir;
  }

  private publish(instanceId: string): void {
    this.bus.publish(Events.INSTANCE_UPDATED, { id: instanceId, action: "imported" }, instanceId);
  }
}

export function normalizeLoader(loader: string): string {
  if (loader === "neoforge") return "neoforge";
  if (loader === "fabric" || loader === "forge" || loader === "quilt") return loader;
  return "vanilla";
}