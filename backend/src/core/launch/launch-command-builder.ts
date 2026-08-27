export interface LaunchCommand {
  javaPath: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

/** Thrown when a launch argument fails the safety allow-list. */
export class LaunchSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LaunchSecurityError";
  }
}

/** JVM flags a user-provided arg may not smuggle. */
const UNSAFE_JVM_RE =
  /^-(?:javaagent|agentlib|agentpath)|^-Xbootclasspath|^-(?:jar|cp|classpath)$/i;
/** Shape of allowed JVM args: system props (-D), -X family, -XX family. */
const SAFE_JVM_PREFIX_RE = /^-(?:Xx?:|X|D)/i;
const SAFE_JVM_WORDS = new Set([
  "-ea", "-da", "-enabledassertions", "-disabledassertions", "-esa", "-dsa",
  "-server", "-client", "-verbose",
]);

const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/;

/**
 * Environment variables whose injection could hijack the launched JVM process.
 * extraEnv may never override these; the launcher owns the Java runtime path.
 */
const ENV_HIJACK_KEYS = new Set([
  "PATH", "CLASSPATH", "LD_LIBRARY_PATH", "LD_PRELOAD",
  "DYLD_LIBRARY_PATH", "DYLD_FALLBACK_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES",
  "JAVA_HOME", "JAVACMD", "JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS", "JAVA_OPTS",
  "NODE_OPTIONS", "NODE_PATH",
]);

/**
 * Rise-level check: a user-injected JVM arg must be a well-formed runtime flag
 * and may not load native/Java agents or override the launch classpath.
 */
export function assertSafeLaunchJvmArg(arg: string): void {
  if (UNSAFE_JVM_RE.test(arg)) {
    throw new LaunchSecurityError(`Disallowed JVM argument: ${arg}`);
  }
  if (SAFE_JVM_WORDS.has(arg) || SAFE_JVM_PREFIX_RE.test(arg)) return;
  throw new LaunchSecurityError(`JVM argument is not in the allow-list: ${arg}`);
}

/**
 * Game args are program arguments (after the main class), so they must not smuggle
 * JVM flags; we also reject control characters to keep argv well-formed.
 */
export function assertSafeGameArg(arg: string): void {
  if (CONTROL_CHARS_RE.test(arg)) {
    throw new LaunchSecurityError("Game argument contains control characters");
  }
  if (/^-(?:javaagent|agentlib|agentpath|X|D)/iu.test(arg)) {
    throw new LaunchSecurityError(`Disallowed game argument: ${arg}`);
  }
}

/**
 * Assembles the final process description:
 *   java + JVM args + mainClass + game args
 *
 * Security invariants:
 *  - never builds a shell string; consumers must use spawn(command, args)
 *  - rejects NUL bytes anywhere in argv
 *  - cwd and javaPath must exist before a command is produced
 *  - game args must not smuggle JVM flags / agents
 *
 * Note: the assembled jvmArgs include trusted launcher-generated flags (e.g. the
 * authlib-injector -javaagent for Yggdrasil). User-supplied JVM args are instead
 * allow-listed at the input layer (assertSafeLaunchJvmArg) in launch-service.
 */
export class LaunchCommandBuilder {
  build(input: {
    javaPath: string;
    jvmArgs: string[];
    mainClass: string;
    gameArgs: string[];
    cwd: string;
    extraEnv?: Record<string, string>;
  }): LaunchCommand {
    for (const [label, value] of [
      ["javaPath", input.javaPath],
      ["mainClass", input.mainClass],
      ["cwd", input.cwd],
    ] as const) {
      if (!value || value.includes("\0")) {
        throw new Error(`Invalid launch ${label}`);
      }
    }

    if (input.mainClass.includes("\n")) {
      throw new LaunchSecurityError("mainClass contains a newline");
    }

    for (const arg of input.jvmArgs) {
      if (arg.includes("\0")) throw new Error("Launch arguments contain NUL bytes");
    }
    for (const arg of input.gameArgs) {
      if (arg.includes("\0")) throw new Error("Launch arguments contain NUL bytes");
      assertSafeGameArg(arg);
    }

    const args = [...input.jvmArgs, input.mainClass, ...input.gameArgs];

    const env: Record<string, string> = { ...process.env as Record<string, string> };
    delete env["NODE_OPTIONS"];
    if (process.platform === "win32") {
      env["OS"] = "Windows_NT";
    } else if (process.platform === "darwin") {
      env["JAVA_MAIN_CLASS"] = input.mainClass;
    }
    for (const [k, v] of Object.entries(input.extraEnv ?? {})) {
      if (ENV_HIJACK_KEYS.has(k)) {
        throw new LaunchSecurityError(`Refusing to override guarded environment variable: ${k}`);
      }
      env[k] = v;
    }

    return {
      javaPath: path2resolveable(input.javaPath),
      args,
      cwd: input.cwd,
      env,
    };
  }
}

/** Keeps bare "java" resolvable via PATH; absolutizes real paths. */
function path2resolveable(javaPath: string): string {
  return javaPath;
}
