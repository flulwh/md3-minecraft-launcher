import { z } from "zod";

export const yggdrasilLoginSchema = z.object({
  username: z.string().min(1).max(320),
  password: z.string().min(1).max(1024),
  profileName: z.string().max(64).optional(),
});

export const offlineLoginSchema = z.object({
  username: z.string().min(1).max(16),
});

export const accountIdParamSchema = z.object({
  id: z.string().min(1),
});

export const versionParamSchema = z.object({
  version: z.string().min(1),
});

export const listVersionsQuerySchema = z.object({
  type: z.enum(["release", "snapshot", "old_beta", "old_alpha", "all"]).default("all"),
  limit: z.coerce.number().int().min(1).max(2000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const createInstanceSchema = z.object({
  name: z.string().min(1).max(64),
  minecraftVersion: z.string().min(1).max(64),
  loader: z.enum(["vanilla", "fabric", "forge", "neoforge", "quilt"]).default("vanilla"),
  loaderVersion: z.string().max(64).optional(),
  javaPath: z.string().max(512).optional(),
  memoryMinMb: z.number().int().min(128).max(65536).optional(),
  memoryMaxMb: z.number().int().min(256).max(65536).optional(),
  jvmArgs: z.array(z.string().max(1024)).max(256).optional(),
  gameArgs: z.record(z.string(), z.string().max(1024)).optional(),
  width: z.number().int().min(320).max(16384).optional(),
  height: z.number().int().min(240).max(16384).optional(),
  fullscreen: z.boolean().optional(),
  serverIp: z.string().max(255).optional(),
  tags: z.array(z.string().min(1).max(32)).max(32).optional(),
  favorite: z.boolean().optional(),
});

export const patchInstanceSchema = createInstanceSchema.partial();

export const idParamSchema = z.object({
  id: z.string().min(1),
});

export const repairSchema = z.object({
  deepAssets: z.boolean().optional(),
});

export const backupSchema = z.object({
  kind: z.enum(["manual", "prelaunch", "postlaunch", "auto", "beforeDelete"]).optional(),
  label: z.string().min(1).max(64).optional(),
});

export const duplicateSchema = z.object({
  name: z.string().min(1).max(64).optional(),
});

export const installLoaderSchema = z.object({
  minecraftVersion: z.string().min(1).max(64),
  loaderVersion: z.string().min(1).max(64),
});

export const launchRequestSchema = z.object({
  instanceId: z.string().min(1),
  accountId: z.string().min(1),
  dryRun: z.boolean().optional(),
  skipPreflight: z.boolean().optional(),
});

export const sessionIdParamSchema = z.object({
  sessionId: z.string().min(1),
});

export const taskIdParamSchema = z.object({
  taskId: z.string().min(1),
});

export const updateSettingsSchema = z.object({
  downloadConcurrency: z.number().int().min(1).max(64).optional(),
  defaultMemoryMaxMb: z.number().int().min(256).max(65536).optional(),
  preferredJavaPath: z.string().max(512).nullable().optional(),
  extraJvmArgs: z.array(z.string().max(1024)).max(128).optional(),
  mirrorMode: z.enum(["auto", "official", "bmclapi"]).optional(),
});

export const listLogsQuerySchema = z.object({
  level: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(1000),
  afterId: z.coerce.number().int().min(0).optional(),
});
