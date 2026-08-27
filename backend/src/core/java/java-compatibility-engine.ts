import fs from "node:fs";
import path from "node:path";

/**
 * Java Runtime Compatibility Engine (JRCE).
 *
 * Pure, data-driven module answering two questions:
 *  1. "Which Java major does this Minecraft version need/expect?"
 *  2. "Is this selected Java major actually compatible with the Minecraft version?"
 *
 * Rules live OUT of band in `config/java/minecraft-java-rules.json` so version
 * changes never require touching launch business code.
 */

interface MinecraftJavaRule {
  id: string;
  minVersion: string | null;
  maxVersion: string | null;
  minJava: number;
  recommendedJava: number;
}

export interface JavaCompatibilityCheck {
  compatible: boolean;
  minJava: number;
  recommendedJava: number;
  actual: number;
  reason: string;
}

let cachedRules: MinecraftJavaRule[] | null = null;

/** Numeric dot-segment compare: "26.2" > "1.20.5". Returns -1|0|1. */
export function compareMinecraftVersions(a: string, b: string): number {
  const as = a.split(".").map((s) => Number.parseInt(s, 10) || 0);
  const bs = b.split(".").map((s) => Number.parseInt(s, 10) || 0);
  const len = Math.max(as.length, bs.length);
  for (let i = 0; i < len; i++) {
    const x = as[i] ?? 0;
    const y = bs[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

function ruleConfigPath(): string {
  return path.join(__dirname, "../../../config/java/minecraft-java-rules.json");
}

function loadRules(): MinecraftJavaRule[] {
  if (cachedRules) return cachedRules;
  const raw = fs.readFileSync(ruleConfigPath(), "utf8");
  const parsed = JSON.parse(raw) as { rules: MinecraftJavaRule[] };
  const rules = [...(parsed.rules ?? [])].sort((x, y) => {
    const a = x.minVersion ?? "";
    const b = y.minVersion ?? "";
    if (a === b) return 0;
    if (a === "") return 1; // unbounded-lower ranges go last
    if (b === "") return -1;
    return compareMinecraftVersions(b, a); // newest range first
  });
  cachedRules = rules;
  return rules;
}

/** Finds the first rule whose range contains the Minecraft version, or null. */
export function findRuleFor(minecraftVersion: string): MinecraftJavaRule | undefined {
  return loadRules().find((rule) => {
    const okLower = rule.minVersion === null || compareMinecraftVersions(minecraftVersion, rule.minVersion) >= 0;
    const okUpper = rule.maxVersion === null || compareMinecraftVersions(minecraftVersion, rule.maxVersion) <= 0;
    return okLower && okUpper;
  });
}

/** Required Java major for a Minecraft version (rule table first). */
export function requiredMajorForVersion(minecraftVersion: string): number | undefined {
  const rule = findRuleFor(minecraftVersion);
  return rule?.minJava;
}

export function recommendedMajorForVersion(minecraftVersion: string): number | undefined {
  const rule = findRuleFor(minecraftVersion);
  return rule?.recommendedJava;
}

/** Compatibility verdict for a chosen Java major against a Minecraft version. */
export function checkJavaCompatibility(minecraftVersion: string, actualMajor: number): JavaCompatibilityCheck {
  const rule = findRuleFor(minecraftVersion);
  const minJava = rule?.minJava ?? 8;
  const recommendedJava = rule?.recommendedJava ?? minJava;
  const compatible = actualMajor >= minJava;
  const reason = rule
    ? `${minecraftVersion} expects Java ${minJava}+ (recommended ${recommendedJava}); selected Java ${actualMajor} is ${compatible ? "compatible" : "too old"}`
    : `no compatibility rule for ${minecraftVersion}; selected Java ${actualMajor}`;
  return { compatible, minJava, recommendedJava, actual: actualMajor, reason };
}