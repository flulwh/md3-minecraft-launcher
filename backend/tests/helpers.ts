import os from "node:os";
import path from "node:path";
import pino from "pino";
import type { AppConfig } from "../src/config/env.js";
import type { RuntimeEnvironment } from "../src/utils/runtime-env.js";

/** Silent logger so unit tests don't spam stdout. */
export function makeLogger() {
  return pino({ level: "silent" });
}

/** Minimal config — only `librariesDir` is read by the units under test. */
export function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const librariesDir = path.join(os.tmpdir(), "launcher-test-libs");
  return {
    env: {} as AppConfig["env"],
    isProd: false,
    rootDir: os.tmpdir(),
    dataDir: os.tmpdir(),
    instancesDir: os.tmpdir(),
    downloadsDir: os.tmpdir(),
    cacheDir: os.tmpdir(),
    minecraftDir: os.tmpdir(),
    versionsDir: os.tmpdir(),
    librariesDir,
    assetsDir: os.tmpdir(),
    assetIndexesDir: os.tmpdir(),
    assetObjectsDir: os.tmpdir(),
    runtimesDir: os.tmpdir(),
    logsDir: os.tmpdir(),
    ...overrides,
  };
}

export function makeEnv(overrides: Partial<RuntimeEnvironment> = {}): RuntimeEnvironment {
  return {
    os: "windows",
    osName: "win32",
    arch: "x86_64",
    features: {},
    ...overrides,
  };
}
