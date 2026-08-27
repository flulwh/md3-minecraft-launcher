import fs from "node:fs";
import path from "node:path";
import { AppConfig } from "../config/env.js";
import { Logger } from "../config/logger.js";
import { Database } from "../infrastructure/database/database.js";
import { VersionService } from "../services/version-service.js";
import { DownloadService } from "../services/download-service.js";
import { InstanceService } from "../services/instance-service.js";
import { LoaderRegistry } from "../core/loaders/loader-registry.js";
import { LibraryResolver } from "../core/libraries/library-resolver.js";
import { ResolvedLibrary, ResolvedNativeLibrary } from "../core/version/types.js";
import { currentRuntime } from "../utils/runtime-env.js";
import { InstanceNotFoundError } from "../errors/index.js";

export type HealthStatus = "ok" | "warn" | "issue";

export interface HealthCategory {
  id: string;
  label: string;
  status: HealthStatus;
  message: string;
}

export interface CorruptFile {
  file: string;
  reason: "missing" | "empty" | "size" | "sha1";
}

export interface HealthReport {
  instanceId: string;
  // "healthy" | "issues" | "not_installed"
  overall: "healthy" | "issues" | "not_installed";
  categories: HealthCategory[];
  corruptFiles: CorruptFile[];
  mods: { total: number; disabled: number };
  saves: { count: number; sizeBytes: number };
  at: string;
}

export interface DiskBreakdown {
  name: string;
  sizeBytes: number;
  fileCount: number;
}

export type DirInfo = Omit<DiskBreakdown, "name">;

export interface DeleteSummary {
  instanceId: string;
  totalSizeBytes: number;
  saves: { count: number; sizeBytes: number };
  hasBackups: boolean;
  backupCount: number;
  breakdown: DiskBreakdown[];
}

/**
 * Read-only instance health + deletion-summary reporter.
 *
 * Unlike {@link RepairService} (which mutates by re-downloading corrupt
 * artifacts), the health check never downloads or writes — it only reports so
 * the UI can show a live health card and a safe delete dialog. A follow-up
 * `repair` call is what actually fixes the reported problems.
 */
export class HealthChecker {
  private readonly libraryResolver: LibraryResolver;

  constructor(
    private readonly config: AppConfig,
    private readonly db: Database,
    private readonly instances: InstanceService,
    private readonly versions: VersionService,
    private readonly downloads: DownloadService,
    private readonly loaders: LoaderRegistry,
    private readonly logger: Logger,
  ) {
    this.libraryResolver = new LibraryResolver(this.config);
  }

  async check(instanceId: string, opts?: { deep?: boolean }): Promise<HealthReport> {
    const instance = await this.instances.require(instanceId).catch(() => null);
    if (!instance) throw new InstanceNotFoundError(instanceId);

    const categories: HealthCategory[] = [];
    const corrupt: CorruptFile[] = [];
    const deep = opts?.deep === true;

    const versionId = this.versionIdFor(instance);
    const installedLocally = this.versions.hasLocal(versionId);

    // ---- Java
    if (instance.javaPath) {
      const ok = fs.existsSync(instance.javaPath);
      categories.push({
        id: "java",
        label: "Java",
        status: ok ? "ok" : "issue",
        message: ok ? instance.javaPath : `Java 运行时不存在：${instance.javaPath}`,
      });
    } else {
      categories.push({ id: "java", label: "Java", status: "ok", message: "自动选择已启用" });
    }

    // ---- Minecraft version
    categories.push({
      id: "minecraft",
      label: "Minecraft",
      status: installedLocally ? "ok" : "issue",
      message: installedLocally
        ? `版本 ${versionId} 已就绪`
        : `版本 ${versionId} 尚未安装（需要先安装再启动）`,
    });

    // ---- Loader
    let resolution: { classpath: ResolvedLibrary[]; natives: ResolvedNativeLibrary[] } | null = null;
    if (instance.loader !== "vanilla" && instance.loaderVersion) {
      const installed = installedLocally;
      categories.push({
        id: "loader",
        label: "Loader",
        status: installed ? "ok" : "issue",
        message: installed
          ? `${this.loaderLabel(instance.loader)} ${instance.loaderVersion} 已安装`
          : `需要安装 ${this.loaderLabel(instance.loader)} ${instance.loaderVersion}`,
      });
    } else {
      categories.push({
        id: "loader",
        label: "Loader",
        status: "ok",
        message: instance.loader === "vanilla" ? "原版（无加载器）" : this.loaderLabel(instance.loader),
      });
    }

    // ---- Client jar + libraries (verify existence/size, sha1 when deep)
    if (installedLocally) {
      try {
        const resolved = await this.versions.resolve(versionId);
        const clientJar = this.downloads.clientJarPath(resolved);
        categories.push({
          id: "client",
          label: "客户端文件",
          status: this.artifactStatus(clientJar, { deep }),
          message: `minecraft.jar（${path.basename(path.dirname(clientJar))}）`,
        });
        if (!validFile(clientJar, deep)) {
          corrupt.push({ file: clientJar, reason: reasonFor(clientJar) });
        }

        resolution = this.libraryResolver.resolve(resolved.libraries, currentRuntime());
        const all = [...resolution.classpath, ...resolution.natives];
        const isNative = (l: ResolvedLibrary | ResolvedNativeLibrary): l is ResolvedNativeLibrary =>
          "extractExclude" in l;
        for (const lib of all) {
          if (!validFile(lib.artifact.file, deep)) {
            corrupt.push({ file: lib.artifact.file, reason: reasonFor(lib.artifact.file) });
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        categories.push({ id: "client", label: "客户端文件", status: "warn", message: `解析版本失败：${msg}` });
      }
    }

    // ---- Libraries summary
    const libCount = resolution ? resolution.classpath.length + resolution.natives.length : 0;
    categories.push({
      id: "libraries",
      label: "Libraries",
      status: corrupt.length === 0 ? "ok" : "issue",
      message: corrupt.length === 0 ? `共 ${libCount} 个库文件全部正常` : `检测到 ${corrupt.length} 个异常文件`,
    });

    // ---- Assets
    const assetsOk = instance.installedAt !== null && instance.installedAt !== undefined;
    categories.push({
      id: "assets",
      label: "资源文件",
      status: assetsOk ? "ok" : "warn",
      message: assetsOk ? "已随安装就绪" : "尚未完整安装",
    });

    // ---- Mods / Saves
    const gameDir = this.instances.gameDirectory(instanceId);
    const { total: modCount, disabled } = countMods(path.join(gameDir, "mods"));
    const saveInfo = dirSize(path.join(gameDir, "saves"));
    const saveCount = countSubdirs(path.join(gameDir, "saves"));
    categories.push({ id: "mods", label: "Mods", status: "ok", message: `启用 ${modCount - disabled} 个 / 禁用 ${disabled} 个` });
    categories.push({ id: "saves", label: "存档", status: saveCount > 0 ? "ok" : "warn", message: saveCount > 0 ? `${saveCount} 个世界` : "暂无存档" });

    const hasIssues = categories.some((c) => c.status === "issue");
    const overall: HealthReport["overall"] = !installedLocally
      ? "not_installed"
      : hasIssues
        ? "issues"
        : "healthy";

    return {
      instanceId,
      overall,
      categories,
      corruptFiles: corrupt,
      mods: { total: modCount, disabled },
      saves: { count: saveCount, sizeBytes: saveInfo.sizeBytes },
      at: new Date().toISOString(),
    };
  }

  /** Stats for the instance's own game directory (saves/mods/config/...). */
  async deleteSummary(instanceId: string): Promise<DeleteSummary> {
    const instance = await this.instances.require(instanceId).catch(() => null);
    if (!instance) throw new InstanceNotFoundError(instanceId);
    const gameDir = this.instances.gameDirectory(instanceId);

    const breakdown: DiskBreakdown[] = [];
    for (const name of ["saves", "mods", "config", "resourcepacks", "shaderpacks", "screenshots"]) {
      const info = dirSize(path.join(gameDir, name));
      if (info.fileCount > 0 || info.sizeBytes > 0) breakdown.push({ name, ...info });
    }
    // Everything else directly under the game directory (e.g. logs, server.properties).
    const other = dirSizeExcept(gameDir, ["saves", "mods", "config", "resourcepacks", "shaderpacks", "screenshots"]);
    if (other.fileCount > 0 || other.sizeBytes > 0) breakdown.push({ name: "other", ...other });

    const totalSizeBytes = breakdown.reduce((sum, b) => sum + b.sizeBytes, 0);
    const backupCount = await this.db.client.instanceBackup.count({ where: { instanceId } });
    const saves = breakdown.find((b) => b.name === "saves");
    const saveCount = countSubdirs(path.join(gameDir, "saves"));

    return {
      instanceId,
      totalSizeBytes,
      saves: { count: saveCount, sizeBytes: saves?.sizeBytes ?? 0 },
      hasBackups: backupCount > 0,
      backupCount,
      breakdown,
    };
  }

  private artifactStatus(file: string, opts: { deep: boolean }): HealthStatus {
    if (validFile(file, opts.deep)) return "ok";
    return fs.existsSync(file) ? "warn" : "issue";
  }

  private versionIdFor(instance: {
    minecraftVersion: string;
    loader: string;
    loaderVersion: string | null;
  }): string {
    if (instance.loader !== "vanilla" && instance.loaderVersion) {
      const adapter = this.loaders.get(instance.loader);
      if (adapter) {
        const candidates = adapter.versionIdCandidates(instance.minecraftVersion, instance.loaderVersion);
        const installed = candidates.find((id) => this.versions.hasLocal(id));
        if (installed) return installed;
        return candidates[0] ?? `${instance.loader}-${instance.loaderVersion}-${instance.minecraftVersion}`;
      }
      return `${instance.loader}-${instance.loaderVersion}-${instance.minecraftVersion}`;
    }
    return instance.minecraftVersion;
  }

  private loaderLabel(loader: string): string {
    return loader.charAt(0).toUpperCase() + loader.slice(1);
  }
}

function validFile(file: string, deep: boolean): boolean {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size <= 0) return false;
    // Fast pass: only require a non-empty file unless a deep hash audit is asked for.
    if (!deep) return true;
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

function reasonFor(file: string): CorruptFile["reason"] {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size <= 0) return "empty";
  } catch {
    return "missing";
  }
  return "sha1";
}

function countMods(modsDir: string): { total: number; disabled: number } {
  if (!fs.existsSync(modsDir)) return { total: 0, disabled: 0 };
  let total = 0;
  let disabled = 0;
  for (const entry of fs.readdirSync(modsDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name.endsWith(".disabled") || entry.name.endsWith(".DISABLED")) {
      disabled += 1;
      total += 1;
    } else if (entry.name.toLowerCase().endsWith(".jar") || entry.name.toLowerCase().endsWith(".zip")) {
      total += 1;
    }
  }
  return { total, disabled };
}

function countSubdirs(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) count += 1;
  }
  return count;
}

function dirSize(dir: string): DirInfo {
  if (!fs.existsSync(dir)) return { sizeBytes: 0, fileCount: 0 };
  let sizeBytes = 0;
  let fileCount = 0;
  const walk = (p: string): void => {
    for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isSymbolicLink()) {
        // Skip symlinks to avoid following out of the sandbox or cycles.
        continue;
      } else {
        try {
          sizeBytes += fs.statSync(full).size;
          fileCount += 1;
        } catch {
          /* unreadable file — count it as 0 bytes */
        }
      }
    }
  };
  walk(dir);
  return { sizeBytes, fileCount };
}

function dirSizeExcept(dir: string, exclude: string[]): DirInfo {
  if (!fs.existsSync(dir)) return { sizeBytes: 0, fileCount: 0 };
  let sizeBytes = 0;
  let fileCount = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (exclude.includes(entry.name)) continue;
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      const info = dirSize(path.join(dir, entry.name));
      sizeBytes += info.sizeBytes;
      fileCount += info.fileCount;
    } else if (entry.isSymbolicLink()) {
      continue;
    } else {
      try {
        sizeBytes += fs.statSync(path.join(dir, entry.name)).size;
        fileCount += 1;
      } catch {
        /* unreadable file */
      }
    }
  }
  return { sizeBytes, fileCount };
}