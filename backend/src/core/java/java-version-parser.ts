export interface ParsedJavaVersion {
  versionString: string;
  majorVersion: number;
  vendor: string | null;
  architecture: string | null;
}

/**
 * Parses `java -version` output. Handles:
 *   openjdk version "21.0.1" 2023-10-17
 *   java version "1.8.0_392"
 *   openjdk version "1.8.0_392-..."
 *   Java(TM) SE Runtime Environment (build 17.0.9+9-LTS)
 */
export function parseJavaVersionOutput(output: string): { versionString: string; majorVersion: number } | null {
  const match = /version "([^"]+)"/.exec(output);
  if (!match) return null;
  const versionString = match[1]!;
  return { versionString, majorVersion: extractMajorVersion(versionString) };
}

/** "1.8.0_392" -> 8, "21.0.1" -> 21, "17" -> 17 */
export function extractMajorVersion(versionString: string): number {
  const parts = versionString.split(/[._+-]/);
  const first = Number.parseInt(parts[0] ?? "0", 10);
  if (first === 1) {
    // legacy scheme: 1.<major>.<update>
    const second = Number.parseInt(parts[1] ?? "8", 10);
    return Number.isNaN(second) ? 8 : second;
  }
  return Number.isNaN(first) ? 0 : first;
}

export interface StructuredJavaVersion {
  major: number;
  minor: number;
  patch: number;
  /** Legacy-update segment only (e.g. "1.8.0_381" -> 381); null for modern schemes. */
  update: number | null;
  /** Vendor build suffix, e.g. "+9-LTS" of "17.0.9+9-LTS". */
  build: string | null;
  full: string;
}

/**
 * Decomposes a Java version string into structured fields.
 *   "1.8.0_381"  -> { major 8,  minor 0, patch 0, update 381 }
 *   "17.0.9+9-LTS"-> { major 17, minor 0, patch 9, update null }
 *   "21.0.8"      -> { major 21, minor 0, patch 8, update null }
 *   "25"          -> { major 25, minor 0, patch 0, update null }
 */
export function parseJavaVersion(versionString: string): StructuredJavaVersion {
  const trimmed = versionString.trim();
  const buildMatch = /^([0-9.]+_?[0-9]*)([+].*)?$/.exec(trimmed);
  const full = trimmed;
  if (!buildMatch) {
    return { major: 0, minor: 0, patch: 0, update: null, build: null, full };
  }
  const body = buildMatch[1] ?? "";
  const build = buildMatch[2] ?? null;
  const parts = body.split(/[._]/).map((s) => Number.parseInt(s, 10));
  const [a = 0, b = 0, c = 0, d = 0] = parts;
  if (a === 1) {
    // legacy "1.<major>.0_<update>" (e.g. 1.8.0_381 -> 8.0.x update 381)
    return { major: b, minor: c, patch: 0, update: Number.isNaN(d) ? null : d, build, full };
  }
  return { major: a, minor: b, patch: c, update: null, build, full };
}

/**
 * Parses `-XshowSettings:properties -version` output for os.arch / sun.arch.data.model.
 */
export function parseJavaArch(output: string): string | null {
  const match = /^\s*os\.arch\s*=\s*(\S+)$/m.exec(output);
  if (match?.[1]) return match[1];
  const dataModel = /^\s*sun\.arch\.data\.model\s*=\s*(\d+)$/m.exec(output);
  if (dataModel?.[1] === "32") return "x86";
  if (dataModel?.[1] === "64") return "x86_64";
  return null;
}

export function guessVendorFromPath(javaPath: string): string | null {
  const p = javaPath.toLowerCase();
  if (p.includes("temurin") || p.includes("adoptium")) return "Eclipse Adoptium";
  if (p.includes("zulu")) return "Azul Zulu";
  if (p.includes("corretto")) return "Amazon Corretto";
  if (p.includes("graal")) return "GraalVM";
  if (p.includes("microsoft")) return "Microsoft OpenJDK";
  if (p.includes("oracle")) return "Oracle";
  if (p.includes("java-se-ri")) return "OpenJDK RI";
  if (p.includes("liberica")) return "BellSoft Liberica";
  if (p.includes("jetbrains")) return "JetBrains Runtime";
  if (p.includes("minecraft") || p.includes("runtime")) return "Mojang";
  return null;
}
