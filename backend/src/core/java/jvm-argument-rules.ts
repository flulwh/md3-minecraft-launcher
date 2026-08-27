import fs from "node:fs";
import path from "node:path";

/**
 * JVM Argument Compatibility Engine.
 *
 * Every argument passed to the Java VM is filtered through the rules in
 * `config/java/jvm-argument-rules.json`. A rule declares argument(s) that only
 * exist on a given Java release onward (`minJava`). On an older runtime those
 * flags are unrecognized and abort startup with "Unrecognized option", so they
 * are stripped BEFORE the command is built — the launcher no longer patches
 * arguments ad-hoc in business code.
 */

export interface JvmArgumentRule {
  id: string;
  arguments: string[];
  minJava: number;
  reason: string;
}

export interface RemovedJvmArgument {
  ruleId: string;
  argument: string;
  minJava: number;
  reason: string;
}

export interface JvmArgumentIssue {
  code: "UNSUPPORTED_JVM_ARGUMENT";
  severity: "error";
  argument: string;
  ruleId: string;
  minJava: number;
  message: string;
}

let cachedRules: JvmArgumentRule[] | null = null;

function rulesConfigPath(): string {
  return path.join(__dirname, "../../../config/java/jvm-argument-rules.json");
}

export function loadJvmArgumentRules(): JvmArgumentRule[] {
  if (cachedRules) return cachedRules;
  const raw = fs.readFileSync(rulesConfigPath(), "utf8");
  const parsed = JSON.parse(raw) as { rules: JvmArgumentRule[] };
  cachedRules = parsed.rules ?? [];
  return cachedRules;
}

function ruleForArgument(arg: string): JvmArgumentRule | undefined {
  return loadJvmArgumentRules().find((r) => r.arguments.includes(arg));
}

/**
 * Drops arguments the selected Java runtime cannot parse. Returns the cleaned
 * list plus what was removed (for logging / UI).
 */
export function applyJvmArgumentRules(args: string[], javaMajor: number): { args: string[]; removed: RemovedJvmArgument[] } {
  const removed: RemovedJvmArgument[] = [];
  const kept: string[] = [];
  for (const arg of args) {
    const rule = ruleForArgument(arg);
    if (rule !== undefined && javaMajor < rule.minJava) {
      removed.push({ ruleId: rule.id, argument: arg, minJava: rule.minJava, reason: rule.reason });
      continue;
    }
    kept.push(arg);
  }
  return { args: kept, removed };
}

/** Reports every version-incompatible argument (pre-launch validation). */
export function validateJvmArguments(args: string[], javaMajor: number): JvmArgumentIssue[] {
  const issues: JvmArgumentIssue[] = [];
  for (const arg of args) {
    const rule = ruleForArgument(arg);
    if (rule !== undefined && javaMajor < rule.minJava) {
      issues.push({
        code: "UNSUPPORTED_JVM_ARGUMENT",
        severity: "error",
        argument: arg,
        ruleId: rule.id,
        minJava: rule.minJava,
        message: `JVM 参数 ${arg} 需要 Java ${rule.minJava}+，当前运行 Java ${javaMajor}（${rule.reason}）`,
      });
    }
  }
  return issues;
}