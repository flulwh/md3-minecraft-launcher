import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { AppConfig } from "../config/env.js";
import { Logger } from "../config/logger.js";
import { Database } from "../infrastructure/database/database.js";
import { AppError, InstanceNotFoundError, ValidationError } from "../errors/index.js";
import { EventBus, Events } from "../websocket/events.js";
import type { MinecraftProcessManager } from "../core/process/process-manager.js";
import type { InstallationManager } from "../installation/manager.js";

export const instanceCreateSchema = z.object({
  name: z.string().min(1).max(64),
  minecraftVersion: z.string().min(1).max(64),
  loader: z.enum(["vanilla", "fabric", "forge", "neoforge", "quilt"]).default("vanilla"),
  loaderVersion: z.string().max(64).optional(),
  javaPath: z.string().max(512).optional(),
  memoryMinMb: z.number().int().min(128).max(65536).optional(),
  memoryMaxMb: z.number().int().min(256).max(65536).optional(),
  jvmArgs: z.array(z.string().max(1024)).max(256).optional(),
  gameArgs: z.record(z.string().max(1024)).optional(),
  width: z.number().int().min(320).max(16384).optional(),
  height: z.number().int().min(240).max(16384).optional(),
  fullscreen: z.boolean().optional(),
  serverIp: z.string().max(255).optional(),
  tags: z.array(z.string().min(1).max(32)).max(32).optional(),
  favorite: z.boolean().optional(),
  preferredAccountId: z.string().max(64).nullable().optional(),
});

export const instancePatchSchema = instanceCreateSchema.partial();

export type InstanceCreateInput = z.infer<typeof instanceCreateSchema>;
export type InstancePatchInput = z.infer<typeof instancePatchSchema>;

export interface InstanceDto {
  id: string;
  name: string;
  minecraftVersion: string;
  loader: string;
  loaderVersion: string | null;
  javaPath: string | null;
  memoryMinMb: number | null;
  memoryMaxMb: number;
  jvmArgs: string[];
  gameArgs: Record<string, string>;
  width: number | null;
  height: number | null;
  fullscreen: boolean;
  serverIp: string | null;
  tags: string[];
  favorite: boolean;
  preferredAccountId: string | null;
  gameDir: string;
  status: string;
  installedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

type InstanceRow = Awaited<ReturnType<Database["client"]["instance"]["findUniqueOrThrow"]>>;

/**
 * Instance lifecycle: isolated `.minecraft` per instance under INSTANCES_DIR.
 */
export class InstanceService {
  constructor(
    private readonly config: AppConfig,
    private readonly db: Database,
    private readonly bus: EventBus,
    private readonly logger: Logger,
  ) {}

  /** Optional runtime guards, populated after the rest of the app is wired up. */
  setRuntimeGuards(
    installs: InstallationManager,
    processes: MinecraftProcessManager,
  ): void {
    this.installs = installs;
    this.processes = processes;
  }

  private installs?: InstallationManager;
  private processes?: MinecraftProcessManager;

  async create(input: InstanceCreateInput): Promise<InstanceDto> {
    const row = await this.db.client.instance.create({
      data: {
        name: input.name,
        minecraftVersion: input.minecraftVersion,
        loader: input.loader,
        ...(input.loaderVersion !== undefined ? { loaderVersion: input.loaderVersion } : {}),
        ...(input.javaPath !== undefined ? { javaPath: input.javaPath } : {}),
        ...(input.memoryMinMb !== undefined ? { memoryMinMb: input.memoryMinMb } : {}),
        ...(input.memoryMaxMb !== undefined ? { memoryMaxMb: input.memoryMaxMb } : {}),
        ...(input.jvmArgs !== undefined ? { jvmArgs: JSON.stringify(input.jvmArgs) } : {}),
        ...(input.gameArgs !== undefined ? { gameArgs: JSON.stringify(input.gameArgs) } : {}),
        ...(input.width !== undefined ? { width: input.width } : {}),
        ...(input.height !== undefined ? { height: input.height } : {}),
        ...(input.fullscreen !== undefined ? { fullscreen: input.fullscreen } : {}),
        ...(input.serverIp !== undefined ? { serverIp: input.serverIp } : {}),
        ...(input.tags !== undefined ? { tags: JSON.stringify(input.tags) } : {}),
        ...(input.favorite !== undefined ? { favorite: input.favorite } : {}),
        ...(input.preferredAccountId !== undefined ? { preferredAccountId: input.preferredAccountId } : {}),
      },
    });
    this.prepareDirectories(row.id);
    this.bus.publish(Events.INSTANCE_UPDATED, { id: row.id, action: "created" }, row.id);
    return this.toDto(row);
  }

  async list(): Promise<InstanceDto[]> {
    const rows = await this.db.client.instance.findMany({ orderBy: { createdAt: "desc" } });
    return rows.map((r) => this.toDto(r));
  }

  async get(id: string): Promise<InstanceDto> {
    return this.toDto(await this.require(id));
  }

  async update(id: string, patch: InstancePatchInput): Promise<InstanceDto> {
    await this.require(id);
    const row = await this.db.client.instance.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.minecraftVersion !== undefined ? { minecraftVersion: patch.minecraftVersion } : {}),
        ...(patch.loader !== undefined ? { loader: patch.loader } : {}),
        ...(patch.loaderVersion !== undefined ? { loaderVersion: patch.loaderVersion } : {}),
        ...(patch.javaPath !== undefined ? { javaPath: patch.javaPath } : {}),
        ...(patch.memoryMinMb !== undefined ? { memoryMinMb: patch.memoryMinMb } : {}),
        ...(patch.memoryMaxMb !== undefined ? { memoryMaxMb: patch.memoryMaxMb } : {}),
        ...(patch.jvmArgs !== undefined ? { jvmArgs: JSON.stringify(patch.jvmArgs) } : {}),
        ...(patch.gameArgs !== undefined ? { gameArgs: JSON.stringify(patch.gameArgs) } : {}),
        ...(patch.width !== undefined ? { width: patch.width } : {}),
        ...(patch.height !== undefined ? { height: patch.height } : {}),
        ...(patch.fullscreen !== undefined ? { fullscreen: patch.fullscreen } : {}),
        ...(patch.serverIp !== undefined ? { serverIp: patch.serverIp } : {}),
        ...(patch.tags !== undefined ? { tags: JSON.stringify(patch.tags) } : {}),
        ...(patch.favorite !== undefined ? { favorite: patch.favorite } : {}),
        ...(patch.preferredAccountId !== undefined ? { preferredAccountId: patch.preferredAccountId } : {}),
      },
    });
    this.bus.publish(Events.INSTANCE_UPDATED, { id, action: "updated" }, id);
    return this.toDto(row);
  }

  async delete(id: string): Promise<void> {
    await this.require(id);
    await this.assertIdle(id);
    await this.db.client.instance.delete({ where: { id } });
    // Remove the instance's on-disk game files (including saves) together with
    // the database row. This is destructive and confirmed on the client side.
    const dir = path.join(this.config.instancesDir, id);
    assertInsideInstances(this.config.instancesDir, dir);
    await fs.promises.rm(dir, { recursive: true, force: true });
    this.logger.info({ id }, "instance deleted (files removed)");
    this.bus.publish(Events.INSTANCE_UPDATED, { id, action: "deleted" }, id);
  }

  /**
   * Guards file-system mutating operations (delete / backup / restore / export /
   * duplicate) against a running install session or live Minecraft process.
   * Wiping or overwriting the instance directory while either is active would
   * strand a zombie session or corrupt a running game (#2).
   */
  async assertIdle(id: string): Promise<void> {
    if (this.installs && this.installs.hasSession(id)) {
      throw new AppError(
        "INSTALL_IN_PROGRESS",
        "Instance is busy with an install. Cancel the install first.",
        409,
      );
    }
    if (this.processes) {
      const running = this.processes.list().some((p) => p.instanceId === id);
      if (running) {
        throw new AppError(
          "LAUNCH_FAILED",
          "Instance is currently running. Stop the game first.",
          409,
        );
      }
    }
  }

  gameDirectory(instanceId: string): string {
    const dir = path.join(this.config.instancesDir, instanceId, ".minecraft");
    assertInsideInstances(this.config.instancesDir, dir);
    return dir;
  }

  nativesDirectory(instanceId: string, versionId: string): string {
    const safe = versionId.replace(/[^a-zA-Z0-9._-]/g, "_");
    const dir = path.join(this.config.instancesDir, instanceId, ".minecraft", "bin", safe);
    assertInsideInstances(this.config.instancesDir, dir);
    return dir;
  }

  prepareDirectories(instanceId: string): void {
    const gameDir = this.gameDirectory(instanceId);
    fs.mkdirSync(gameDir, { recursive: true });
    this.logger.debug({ instanceId, gameDir }, "instance directories prepared");
  }

  async require(id: string): Promise<InstanceRow> {
    const row = await this.db.client.instance.findUnique({ where: { id } });
    if (!row) throw new InstanceNotFoundError(id);
    return row as unknown as InstanceRow;
  }

  private toDto(row: {
    id: string;
    name: string;
    minecraftVersion: string;
    loader: string;
    loaderVersion: string | null;
    javaPath: string | null;
    memoryMinMb: number | null;
    memoryMaxMb: number;
    jvmArgs: string | null;
    gameArgs: string | null;
    width: number | null;
    height: number | null;
    fullscreen: boolean;
    serverIp: string | null;
    tags: string | null;
    favorite: boolean;
    preferredAccountId: string | null;
    status: string;
    installedAt: Date | null;
    lastError: string | null;
    createdAt: Date;
  }): InstanceDto {
    return {
      id: row.id,
      name: row.name,
      minecraftVersion: row.minecraftVersion,
      loader: row.loader,
      loaderVersion: row.loaderVersion,
      javaPath: row.javaPath,
      memoryMinMb: row.memoryMinMb,
      memoryMaxMb: row.memoryMaxMb,
      jvmArgs: parseJsonArray(row.jvmArgs),
      gameArgs: parseJsonObject(row.gameArgs),
      width: row.width,
      height: row.height,
      fullscreen: row.fullscreen,
      serverIp: row.serverIp,
      tags: parseJsonArray(row.tags),
      favorite: row.favorite,
      preferredAccountId: row.preferredAccountId,
      gameDir: this.gameDirectory(row.id),
      status: row.status,
      installedAt: row.installedAt ? row.installedAt.toISOString() : null,
      lastError: row.lastError,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * Updates the instance-level install lifecycle status. Only `status` is
   * changed unless an options bag explicitly provides timestamps/errors.
   */
  async setStatus(
    id: string,
    status: string,
    opts?: { installedAt?: Date; lastError?: string | null },
  ): Promise<void> {
    const data: { status: string; installedAt?: Date; lastError?: string | null } = { status };
    if (opts?.installedAt !== undefined) data.installedAt = opts.installedAt;
    if (opts !== undefined && "lastError" in opts) data.lastError = opts.lastError;
    await this.db.client.instance.update({ where: { id }, data });
    this.bus.publish(Events.INSTANCE_UPDATED, { id, action: "status", status }, id);
  }
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: string | null): Record<string, string> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function assertInsideInstances(base: string, target: string): void {
  const resolvedBase = path.resolve(base);
  const resolvedTarget = path.resolve(target);
  if (!resolvedTarget.startsWith(resolvedBase + path.sep)) {
    throw new ValidationError("Instance path escapes sandbox");
  }
}
