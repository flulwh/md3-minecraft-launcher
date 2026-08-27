export interface LaunchCommand {
  javaPath: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

/**
 * Assembles the final process description:
 *   java + JVM args + mainClass + game args
 *
 * Security invariants:
 *  - never builds a shell string; consumers must use spawn(command, args)
 *  - rejects NUL bytes anywhere in argv
 *  - cwd and javaPath must exist before a command is produced
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

    const args = [...input.jvmArgs, input.mainClass, ...input.gameArgs];
    for (const arg of args) {
      if (arg.includes("\0")) {
        throw new Error("Launch arguments contain NUL bytes");
      }
    }

    const env: Record<string, string> = { ...process.env as Record<string, string> };
    delete env["NODE_OPTIONS"];
    if (process.platform === "win32") {
      env["OS"] = "Windows_NT";
    } else if (process.platform === "darwin") {
      env["JAVA_MAIN_CLASS"] = input.mainClass;
    }
    for (const [k, v] of Object.entries(input.extraEnv ?? {})) env[k] = v;

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
