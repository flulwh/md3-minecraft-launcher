import { validateJvmArguments, JvmArgumentIssue } from "../java/jvm-argument-rules.js";
import { checkJavaCompatibility, JavaCompatibilityCheck } from "../java/java-compatibility-engine.js";

/**
 * LaunchValidator — pre-launch gate.
 *
 * Runs the full compatibility surface BEFORE the JVM is ever spawned so that
 * version-mismatched launch parameters are caught (and auto-fixed) instead of
 * letting the JVM abort with "Unrecognized option".
 *
 * The validator is a pure decision-maker over the resolved launch context; the
 * actual stripping is performed by the runtime (launch-service) via
 * `applyJvmArgumentRules`, but the validator reports WHAT would be wrong so the
 * UI can offer auto-fix / still-launch without touching Java first.
 */

export interface LaunchValidationContext {
  /** Selected Java major version (e.g. 21). */
  javaMajor: number;
  /** Minecraft version string (e.g. "1.21.1"); optional to skip MC<->Java check. */
  minecraftVersion?: string;
  /** Final assembled JVM arguments (raw, before compatibility stripping). */
  jvmArgs: string[];
}

export interface LaunchIssue {
  code: string;
  severity: "error" | "warning";
  argument?: string;
  minJava?: number;
  currentJava?: number;
  message: string;
  /** Whether the launcher can remove/fix it automatically. */
  autoFixable: boolean;
}

export interface LaunchValidation {
  /** True when there is nothing that blocks startup. */
  valid: boolean;
  /** True when at least one ineligible item can be auto-fixed. */
  autoFixable: boolean;
  issues: LaunchIssue[];
  /** JVM compatibility verdict (only when minecraftVersion provided). */
  javaCompatibility?: JavaCompatibilityCheck;
}

/**
 * Validates a resolved launch context. Ineligible JVM arguments and a too-old
 * Java are reported, but never block the caller from producing a command — the
 * caller decides whether to auto-fix, hard-block, or still launch.
 */
export function validateLaunch(ctx: LaunchValidationContext): LaunchValidation {
  const issues: LaunchIssue[] = [];
  let autoFixable = false;

  // 1) JVM argument version-gating (the "--sun-misc-unsafe-memory-access" class of bug).
  for (const issue of validateJvmArguments(ctx.jvmArgs, ctx.javaMajor)) {
    issues.push(fromJvmIssue(issue, ctx.javaMajor));
    autoFixable = true;
  }

  // 2) Minecraft <-> Java compatibility (only meaningful when a version is known).
  let javaCompatibility: JavaCompatibilityCheck | undefined;
  if (ctx.minecraftVersion !== undefined) {
    javaCompatibility = checkJavaCompatibility(ctx.minecraftVersion, ctx.javaMajor);
    if (!javaCompatibility.compatible) {
      issues.push({
        code: "JAVA_TOO_OLD",
        severity: "error",
        currentJava: ctx.javaMajor,
        autoFixable: false,
        message: javaCompatibility.reason,
      });
    }
  }

  return {
    valid: issues.length === 0,
    autoFixable,
    issues,
    ...(javaCompatibility ? { javaCompatibility } : {}),
  };
}

function fromJvmIssue(issue: JvmArgumentIssue, javaMajor: number): LaunchIssue {
  return {
    code: issue.code,
    severity: issue.severity,
    argument: issue.argument,
    minJava: issue.minJava,
    currentJava: javaMajor,
    message: issue.message,
    autoFixable: true,
  };
}

/** Convenience: compute the JVM args that must be stripped to make a context valid. */
export function autoFix(context: LaunchValidationContext): { stripped: string[]; kept: string[] } {
  const stripped: string[] = [];
  const kept: string[] = [];
  for (const arg of context.jvmArgs) {
    const fixed = validateJvmArguments([arg], context.javaMajor);
    if (fixed.length > 0) stripped.push(arg);
    else kept.push(arg);
  }
  return { stripped, kept };
}