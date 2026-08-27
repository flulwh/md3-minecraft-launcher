import fs from "node:fs";
import path from "node:path";
import { AppConfig } from "../config/env.js";
import { Logger } from "../config/logger.js";
import { Database } from "../infrastructure/database/database.js";
import { EventBus, Events } from "../websocket/events.js";
import { AppError, NotFoundError, SandboxViolationError } from "../errors/index.js";
import { InstanceService } from "../services/instance-service.js";
import { resolveInside, assertInside } from "../utils/paths.js";
import { ExtractBudget } from "../utils/zip-safety.js";

export type BackupKind = "manual" | "prelaunch" | "postlaunch" | "auto" | "beforeDelete";

export interface BackupCreateOptions {
  kind?: BackupKind;
  label?: string;
}

export interface BackupDto {
  id: string;
  instanceId: string;
  kind: string;
  label: string | null;
  fileName: string;
  sizeBytes: number;
  fileCount: number;
  createdAt: string;
}

type BackupRow = Awaited<ReturnType<Database["client"]["instanceBackup"]["findUniqueOrThrow"]>>;

/**
 * Instance backup / restore.
 *
 * Each backup is a self-contained zip of the instance root directory
 * (`<instancesDir>/<instanceId>`), stored under `<dataDir>/backups/<instanceId>/`.
 * Backups are deliberately decoupled from the Instance row (no FK cascade) so a
 * "backup then delete" archive survives instance removal.
 */
export class BackupManager {
  constructor(
    private readonly config: AppConfig,
    private readonly db: Database,
    private readonly bus: EventBus,
    private readonly instances: InstanceService,
    private readonly logger: Logger,
  ) {}

  async create(instanceId: string, opts: BackupCreateOptions = {}): Promise<BackupDto> {
    await this.instances.require(instanceId);
    await this.instances.assertIdle(instanceId);

    const src = path.join(this.config.instancesDir, instanceId);
    assertInside(this.config.instancesDir, src);
    if (!fs.existsSync(src)) {
      throw new NotFoundError("Instance directory", instanceId);
    }

    const dir = this.backupsRoot(instanceId);
    fs.mkdirSync(dir, { recursive: true });
    const ts = stamp();
    const label = opts.label ? sanitizeLabel(opts.label) : "";
    const fileName = `${ts}${label ? `-${label}` : ""}.zip`;
    const dest = path.join(dir, fileName);
    assertInside(this.config.backupsDir, dest);

    const { fileCount, bytes } = await measureDir(src);
    this.logger.info({ instanceId, fileName, fileCount, bytes }, "backup starting");

    const AdmZip = (await import("adm-zip")).default;
    const zip = new AdmZip();
    zip.addLocalFolder(src); // contents land at the zip root, so restore is in-place
    zip.writeZip(dest);
    const stat = fs.statSync(dest);

    this.logger.info({ instanceId, fileName, sizeBytes: stat.size }, "backup completed");
    const row = await this.db.client.instanceBackup.create({
      data: {
        instanceId,
        kind: opts.kind ?? "manual",
        ...(opts.label !== undefined ? { label: opts.label } : {}),
        fileName,
        sizeBytes: stat.size,
        fileCount,
      },
    });
    this.bus.publish(Events.INSTANCE_UPDATED, { id: instanceId, action: "backup.done" }, instanceId);
    return this.toDto(row);
  }

  async list(instanceId: string): Promise<BackupDto[]> {
    await this.instances.require(instanceId);
    const rows = await this.db.client.instanceBackup.findMany({
      where: { instanceId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => this.toDto(r));
  }

  async restore(instanceId: string, backupId: string): Promise<{ restored: boolean; fileCount: number }> {
    await this.instances.require(instanceId);
    await this.instances.assertIdle(instanceId);
    const row = await this.requireBackup(backupId);
    if (row.instanceId !== instanceId) throw new NotFoundError("Backup", backupId);

    const src = this.backupPath(row);
    if (!fs.existsSync(src)) {
      throw new AppError("NOT_FOUND", "Backup archive is missing on disk", 404);
    }

    const target = path.join(this.config.instancesDir, instanceId);
    assertInside(this.config.instancesDir, target);
    fs.mkdirSync(target, { recursive: true });

    this.logger.info({ instanceId, backupId, fileName: row.fileName }, "restore starting");

    const AdmZip = (await import("adm-zip")).default;
    const zip = new AdmZip(src);
    const entries = zip.getEntries();
    let fileEntries = 0;
    const budget = new ExtractBudget();
    for (const entry of entries) {
      budget.reserve(entry);
      const safe = resolveInside(target, entry.entryName);
      if (entry.isDirectory) {
        fs.mkdirSync(safe, { recursive: true });
        continue;
      }
      fileEntries += 1;
      fs.mkdirSync(path.dirname(safe), { recursive: true });
      fs.writeFileSync(safe, entry.getData());
    }

    this.logger.info({ instanceId, backupId, fileEntries }, "restore completed");
    this.bus.publish(Events.INSTANCE_UPDATED, { id: instanceId, action: "restored" }, instanceId);
    return { restored: true, fileCount: fileEntries };
  }

  async remove(backupId: string): Promise<void> {
    const row = await this.requireBackup(backupId);
    const src = this.backupPath(row);
    try {
      await fs.promises.rm(src, { force: true });
    } catch {
      /* best effort — the row is still removed */
    }
    await this.db.client.instanceBackup.delete({ where: { id: backupId } });
    this.bus.publish(Events.INSTANCE_UPDATED, { id: row.instanceId, action: "backup.deleted" }, row.instanceId);
  }

  private async requireBackup(id: string): Promise<BackupRow> {
    const row = await this.db.client.instanceBackup.findUnique({ where: { id } });
    if (!row) throw new NotFoundError("Backup", id);
    return row as unknown as BackupRow;
  }

  private backupsRoot(instanceId: string): string {
    const dir = path.join(this.config.backupsDir, instanceId);
    assertInside(this.config.backupsDir, dir);
    return dir;
  }

  private backupPath(row: { instanceId: string; fileName: string }): string {
    const p = path.join(this.config.backupsDir, row.instanceId, row.fileName);
    assertInside(this.config.backupsDir, p);
    return p;
  }

  private toDto(row: {
    id: string;
    instanceId: string;
    kind: string;
    label: string | null;
    fileName: string;
    sizeBytes: bigint | number;
    fileCount: number;
    createdAt: Date;
  }): BackupDto {
    return {
      id: row.id,
      instanceId: row.instanceId,
      kind: row.kind,
      label: row.label,
      fileName: row.fileName,
      sizeBytes: Number(row.sizeBytes),
      fileCount: row.fileCount,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

function sanitizeLabel(label: string): string {
  const cleaned = label.replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]/g, "_").slice(0, 48);
  return cleaned || "backup";
}

function stamp(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function measureDir(dir: string): Promise<{ fileCount: number; bytes: number }> {
  let fileCount = 0;
  let bytes = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        fileCount += 1;
        try {
          bytes += (await fs.promises.stat(full)).size;
        } catch {
          /* ignore */
        }
      }
    }
  }
  return { fileCount, bytes };
}