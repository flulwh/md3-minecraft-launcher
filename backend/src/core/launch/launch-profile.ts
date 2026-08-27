import { LaunchCommand } from "./launch-command-builder.js";

/**
 * LaunchProfile — a structured, human-readable description of a resolved launch,
 * in contrast to the flat argv list that actually gets spawned. Tracing a
 * profile is far easier than staring at a single argument vector, and it can be
 * surfaced in the UI ("查看启动命令" / "复制启动命令") without leaking raw argv.
 */

export interface LaunchProfile {
  java: { path: string; majorVersion: number; vendor?: string | null };
  jvmArgs: string[];
  classpathEntryCount: number;
  mainClass: string;
  gameArgs: string[];
  environment?: Record<string, string>;
  workingDirectory: string;
  minecraft: { version: string };
  loader: { type: string; version?: string | null };
  memory?: { minMb?: number | null; maxMb?: number };
  fullCommand: string[];
}

export interface LaunchProfileInput extends Omit<LaunchCommand, "args"> {
  args: string[];
  mainClass: string;
  jvmArgs: string[];
  gameArgs: string[];
  minecraftVersion: string;
  loaderType: string;
  loaderVersion?: string | null;
  javaMajor: number;
  javaVendor?: string | null;
  memoryMinMb?: number | null;
  memoryMaxMb?: number;
  classpathEntryCount: number;
}

/**
 * Builds a structured profile. The main class is the split point between JVM
 * args and game args inside the flat argv vector.
 */
export function buildLaunchProfile(input: LaunchProfileInput): LaunchProfile {
  const profile: LaunchProfile = {
    java: { path: input.javaPath, majorVersion: input.javaMajor, ...(input.javaVendor ? { vendor: input.javaVendor } : {}) },
    jvmArgs: [...input.jvmArgs],
    classpathEntryCount: input.classpathEntryCount,
    mainClass: input.mainClass,
    gameArgs: [...input.gameArgs],
    workingDirectory: input.cwd,
    minecraft: { version: input.minecraftVersion },
    loader: { type: input.loaderType, ...(input.loaderVersion ? { version: input.loaderVersion } : {}) },
    ...(input.memoryMaxMb !== undefined ? { memory: { minMb: input.memoryMinMb ?? null, maxMb: input.memoryMaxMb } } : {}),
    fullCommand: [input.javaPath, ...input.jvmArgs, input.mainClass, ...input.gameArgs],
  };

  if (input.env) {
    profile.environment = { ...input.env };
  }
  return profile;
}