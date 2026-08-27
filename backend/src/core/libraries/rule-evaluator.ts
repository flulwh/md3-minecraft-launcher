import { RuleSet, OsName } from "../version/types.js";
import { RuntimeEnvironment } from "../../utils/runtime-env.js";

const ARCH_ALIASES: Record<string, string> = {
  x86_64: "x86_64",
  amd64: "x86_64",
  x64: "x86_64",
  x86: "x86",
  ia32: "x86",
  i386: "x86",
  i686: "x86",
  arm64: "arm64",
  aarch64: "arm64",
  arm: "arm",
  arm32: "arm",
};

function normalizeArch(arch: string): string {
  return ARCH_ALIASES[arch.toLowerCase()] ?? arch.toLowerCase();
}

interface CompiledRuleCondition {
  matches: boolean;
}

function osMatches(
  ruleOs: { name?: string; arch?: string; version?: string },
  env: RuntimeEnvironment,
): boolean {
  if (ruleOs.name !== undefined) {
    const name = ruleOs.name.toLowerCase();
    const validNames: OsName[] = ["windows", "linux", "osx"];
    if (!validNames.includes(name as OsName)) return false;
    if (name !== env.os) return false;
  }
  if (ruleOs.arch !== undefined) {
    if (normalizeArch(ruleOs.arch) !== normalizeArch(env.arch)) return false;
  }
  if (ruleOs.version !== undefined) {
    const subject = env.osVersion ?? "";
    try {
      if (!new RegExp(ruleOs.version).test(subject)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function featuresMatch(
  required: Record<string, boolean>,
  actual: Record<string, boolean>,
): CompiledRuleCondition["matches"] {
  for (const [feature, expected] of Object.entries(required)) {
    if (!(feature in actual) || actual[feature] !== expected) return false;
  }
  return true;
}

/**
 * Evaluates a Mojang rule set against the runtime environment.
 *
 * Semantics (matching the official launcher):
 *  - no rules -> allowed
 *  - rules are evaluated in order; the LAST matching rule wins
 *  - a rule matches when its os condition AND feature condition hold
 *  - if no rule matches, the library is not included
 */
export function evaluateRules(rules: RuleSet | undefined, env: RuntimeEnvironment): boolean {
  if (!rules || rules.length === 0) return true;

  let decided = false;
  let allowed = false;

  for (const rule of rules) {
    const osOk = rule.os !== undefined ? osMatches(rule.os, env) : true;
    if (!osOk) continue;
    const featOk =
      rule.features !== undefined ? featuresMatch(rule.features, env.features) : true;
    if (!featOk) continue;
    allowed = rule.action === "allow";
    decided = true;
  }

  return decided && allowed;
}
