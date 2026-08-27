import { Logger } from "../../config/logger.js";
import { ArgumentEntry, isObjectArgument } from "../version/types.js";
import { RuntimeEnvironment } from "../../utils/runtime-env.js";
import { evaluateRules } from "../libraries/rule-evaluator.js";
import { substituteVariables, VariableMap } from "./variable-substitution.js";

export interface JvmOptions {
  minMemoryMb?: number;
  maxMemoryMb?: number;
  /** user-provided extra JVM args (appended last) */
  extraJvmArgs: string[];
}

/**
 * Resolves `arguments.jvm[]` into a flat argv slice and guarantees the
 * critical flags exist even for legacy versions without a jvm section:
 *   -Djava.library.path / -cp / memory bounds.
 */
export class JvmArgumentResolver {
  constructor(private readonly logger: Logger) {}

  build(
    modernArguments: ArgumentEntry[] | undefined,
    vars: VariableMap,
    env: RuntimeEnvironment,
    opts: JvmOptions,
  ): string[] {
    const out: string[] = [];

    if (modernArguments && modernArguments.length > 0) {
      for (const entry of modernArguments) {
        this.appendEntry(entry, vars, env, out);
      }
    } else {
      // legacy baseline (< 1.13)
      out.push(
        `-Djava.library.path=${vars["natives_directory"] ?? ""}`,
        "-cp",
        vars["classpath"] ?? "",
      );
    }

    this.ensureRequiredFlags(out, vars);

    const hasMemoryFlag = out.some((a) => a.startsWith("-Xms") || a.startsWith("-Xmx"));
    if (!hasMemoryFlag) {
      if (opts.maxMemoryMb !== undefined) out.unshift(`-Xmx${opts.maxMemoryMb}M`);
      if (opts.minMemoryMb !== undefined) out.unshift(`-Xms${opts.minMemoryMb}M`);
    }

    // user extras always win (last occurrence of duplicated JVM properties)
    for (const extra of opts.extraJvmArgs) {
      if (extra.trim().length > 0) out.push(extra);
    }

    return out;
  }

  private ensureRequiredFlags(out: string[], vars: VariableMap): void {
    const nativesDir = vars["natives_directory"] ?? "";
    if (!out.some((a) => a.includes("java.library.path"))) {
      out.push(`-Djava.library.path=${nativesDir}`);
    }
    if (!out.includes("-cp") && !out.some((a) => ["-classpath"].includes(a))) {
      out.push("-cp", vars["classpath"] ?? "");
    }

    // launcher identity defaults
    if (!out.some((a) => a.startsWith("-Dminecraft.launcher.brand="))) {
      out.push(`-Dminecraft.launcher.brand=${vars["launcher_name"] ?? "NodeLauncher"}`);
    }
    if (!out.some((a) => a.startsWith("-Dminecraft.launcher.version="))) {
      out.push(`-Dminecraft.launcher.version=${vars["launcher_version"] ?? "1.0"}`);
    }

    // log4j hardening independent of version metadata
    if (!out.some((a) => a.includes("log4j2.formatMsgNoLookups"))) {
      out.push("-Dlog4j2.formatMsgNoLookups=true");
    }
  }

  private appendEntry(
    entry: ArgumentEntry,
    vars: VariableMap,
    env: RuntimeEnvironment,
    out: string[],
  ): void {
    if (typeof entry === "string") {
      out.push(substituteVariables(entry, vars, this.logger));
      return;
    }
    if (isObjectArgument(entry)) {
      if (entry.rules && !evaluateRules(entry.rules, env)) return;
      const values =
        entry.value !== undefined ? entry.value : entry.values !== undefined ? entry.values : undefined;
      if (values === undefined) return;
      for (const v of Array.isArray(values) ? values : [values]) {
        out.push(substituteVariables(v, vars, this.logger));
      }
    }
  }
}
