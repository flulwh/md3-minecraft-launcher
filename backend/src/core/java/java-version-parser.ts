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
