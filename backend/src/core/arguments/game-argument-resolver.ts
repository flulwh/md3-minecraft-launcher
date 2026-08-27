import { Logger } from "../../config/logger.js";
import {
  ArgumentEntry,
  isObjectArgument,
} from "../version/types.js";
import { RuntimeEnvironment } from "../../utils/runtime-env.js";
import { evaluateRules } from "../libraries/rule-evaluator.js";
import { substituteVariables, tokenizeArgumentString, VariableMap } from "./variable-substitution.js";

/**
 * Resolves `arguments.game[]` (and legacy `minecraftArguments`) into a flat,
 * rule-filtered, variable-substituted argv slice.
 */
export class GameArgumentResolver {
  constructor(private readonly logger: Logger) {}

  build(
    modernArguments: ArgumentEntry[] | undefined,
    legacyArguments: string | undefined,
    vars: VariableMap,
    env: RuntimeEnvironment,
  ): string[] {
    const out: string[] = [];

    if (modernArguments && modernArguments.length > 0) {
      for (const entry of modernArguments) {
        this.appendEntry(entry, vars, env, out);
      }
    }

    if (legacyArguments !== undefined) {
      out.push(...tokenizeArgumentString(legacyArguments).map((t) => substituteVariables(t, vars, this.logger)));
    }

    return out;
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
