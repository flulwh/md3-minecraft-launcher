import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { AppConfig } from "../config/env.js";
import { Logger } from "../config/logger.js";
import { Database } from "../infrastructure/database/database.js";
import { InstanceNotFoundError, ValidationError } from "../errors/index.js";
import { EventBus, Events } from "../websocket/events.js";

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
  gameDir: string;
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
      },
    });
    this.bus.publish(Events.INSTANCE_UPDATED, { id, action: "updated" }, id);
    return this.toDto(row);
  }

  async delete(id: string): Promise<void> {
    await this.require(id);
    await this.db.client.instance.delete({ where: { id } });
    // Remove the instance's on-disk game files (including saves) together with
    // the database row. This is destructive and confirmed on the client side.
    const dir = path.join(this.config.instancesDir, id);
    assertInsideInstances(this.config.instancesDir, dir);
    await fs.promises.rm(dir, { recursive: true, force: true });
    this.logger.info({ id }, "instance deleted (files removed)");
    this.bus.publish(Events.INSTANCE_UPDATED, { id, action: "deleted" }, id);
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
      gameDir: this.gameDirectory(row.id),
      createdAt: row.createdAt.toISOString(),
    };
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
