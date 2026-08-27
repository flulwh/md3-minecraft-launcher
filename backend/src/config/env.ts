import path from "node:path";
import fs from "node:fs";
import { z } from "zod";

const EnvSchema = z.object({
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  DATABASE_URL: z.string().default("file:../data/launcher.db"),
  LAUNCHER_SECRET: z.string().optional(),
  /** Yggdrasil (authlib-injector) auth server base URL, e.g. LittleSkin. */
  YGG_BASE_URL: z.string().default("https://littleskin.cn/api/yggdrasil"),
  DATA_DIR: z.string().default("./data"),
  INSTANCES_DIR: z.string().default("./instances"),
  DOWNLOADS_DIR: z.string().default("./downloads"),
  /**
   * Optional ASCII-path overrides for the jar-bearing stores. Non-ASCII
   * install paths (e.g. a Chinese "桌面" home directory) crash Forge/NeoForge's
   * jarhandling (`java.lang.IllegalArgumentException: Bad escape`, JDK-8386704),
   * so these can be pointed at ASCII paths (symbolic links work fine).
   */
  VERSIONS_DIR: z.string().optional(),
  LIBRARIES_DIR: z.string().optional(),
  ASSETS_DIR: z.string().optional(),
  LAUNCHER_NAME: z.string().default("NodeLauncher"),
  LAUNCHER_VERSION: z.string().default("0.1.0"),
  DOWNLOAD_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(8),
  HTTP_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30_000),
  /** auto = official first with BMCLAPI fallback; bmclapi = CN mirror first */
  MIRROR: z.enum(["auto", "official", "bmclapi"]).default("auto"),
  /**
   * Comma-separated allow-list of CORS origins for the local REST API.
   * "null" is sent by file:// (packaged Electron renderer) pages. Anything
   * not listed here is blocked — the server never reflects arbitrary origins.
   */
  CORS_ORIGINS: z
    .string()
    .default("http://127.0.0.1:5173,http://localhost:5173,null"),
});

export type Env = z.infer<typeof EnvSchema>;

export interface AppConfig {
  env: Env;
  isProd: boolean;
  rootDir: string;
  dataDir: string;
  instancesDir: string;
  downloadsDir: string;
  cacheDir: string;
  minecraftDir: string;
  versionsDir: string;
  librariesDir: string;
  assetsDir: string;
  assetIndexesDir: string;
  assetObjectsDir: string;
  runtimesDir: string;
  logsDir: string;
}

function resolveDir(root: string, value: string): string {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(root, value);
}

/**
 * Finds the backend project root (the directory containing package.json)
 * regardless of whether we run from src/ (tsx), dist/ (tsc) or tests.
 */
function findRootDir(start: string): string {
  let dir = start;
  for (let depth = 0; depth < 8; depth++) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

let cachedConfig: AppConfig | null = null;

export function loadConfig(rootOverride?: string): AppConfig {
  if (cachedConfig) return cachedConfig;

  const rootDir =
    rootOverride ??
    process.env["LAUNCHER_ROOT"] ??
    findRootDir(path.resolve(__dirname, "..", ".."));

  const envFile = path.join(rootDir, ".env");
  if (fs.existsSync(envFile)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("dotenv").config({ path: envFile });
  }

  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const env = parsed.data;

  const minecraftDir = resolveDir(rootDir, env.DATA_DIR + "/minecraft");
  const versionsDir = env.VERSIONS_DIR
    ? resolveDir(rootDir, env.VERSIONS_DIR)
    : resolveDir(rootDir, env.DATA_DIR + "/minecraft/versions");
  const librariesDir = env.LIBRARIES_DIR
    ? resolveDir(rootDir, env.LIBRARIES_DIR)
    : resolveDir(rootDir, env.DATA_DIR + "/minecraft/libraries");
  const assetsDir = env.ASSETS_DIR
    ? resolveDir(rootDir, env.ASSETS_DIR)
    : resolveDir(rootDir, env.DATA_DIR + "/minecraft/assets");

  const config: AppConfig = {
    env,
    isProd: env.NODE_ENV === "production",
    rootDir,
    dataDir: resolveDir(rootDir, env.DATA_DIR),
    instancesDir: resolveDir(rootDir, env.INSTANCES_DIR),
    downloadsDir: resolveDir(rootDir, env.DOWNLOADS_DIR),
    cacheDir: resolveDir(rootDir, env.DATA_DIR + "/cache"),
    minecraftDir,
    versionsDir,
    librariesDir,
    assetsDir,
    assetIndexesDir: path.join(assetsDir, "indexes"),
    assetObjectsDir: path.join(assetsDir, "objects"),
    runtimesDir: resolveDir(rootDir, env.DATA_DIR + "/runtimes"),
    logsDir: resolveDir(rootDir, env.DATA_DIR + "/logs"),
  };

  cachedConfig = config;
  return config;
}

export function ensureDirectories(config: AppConfig): void {
  for (const dir of [
    config.dataDir,
    config.instancesDir,
    config.downloadsDir,
    config.cacheDir,
    config.minecraftDir,
    config.versionsDir,
    config.librariesDir,
    config.assetsDir,
    config.assetIndexesDir,
    config.assetObjectsDir,
    config.runtimesDir,
    config.logsDir,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
