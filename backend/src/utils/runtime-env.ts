export type LauncherOs = "windows" | "linux" | "osx";

export interface RuntimeEnvironment {
  os: LauncherOs;
  osName: string;
  osVersion?: string;
  arch: string;
  features: Record<string, boolean>;
}

function currentOs(): LauncherOs {
  switch (process.platform) {
    case "win32":
      return "windows";
    case "darwin":
      return "osx";
    case "linux":
    case "freebsd":
    case "openbsd":
      return "linux";
    default:
      return process.platform as never;
  }
}

function currentArch(): string {
  switch (process.arch) {
    case "x64":
      return "x86_64";
    case "ia32":
      return "x86";
    case "arm64":
      return "arm64";
    case "arm":
      return "arm";
    default:
      return process.arch;
  }
}

let cachedEnv: RuntimeEnvironment | null = null;

export function currentRuntime(features: Record<string, boolean> = {}): RuntimeEnvironment {
  if (cachedEnv && Object.keys(features).length === 0) return cachedEnv;
  const env: RuntimeEnvironment = {
    os: currentOs(),
    osName: process.platform,
    arch: currentArch(),
    features,
  };
  if (process.platform === "win32") {
    const version = require("node:os").release() as string;
    env.osVersion = version;
  }
  if (Object.keys(features).length === 0) cachedEnv = env;
  return env;
}
