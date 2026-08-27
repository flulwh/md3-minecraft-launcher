import path from "node:path";
import { ResolvedLibrary } from "../version/types.js";
import { LauncherOs } from "../../utils/runtime-env.js";

export interface ClasspathResult {
  entries: string[];
  classpath: string;
}

export class ClasspathBuilder {
  constructor(private readonly librariesDir: string) {}

  /**
   * Builds the launch classpath: all rule-approved library jars + the client
   * jar. Entries are deduplicated and joined with the platform separator
   * (`;` on Windows, `:` elsewhere).
   */
  build(
    libraries: ResolvedLibrary[],
    clientJarPath: string,
    os: LauncherOs,
  ): ClasspathResult {
    const seen = new Set<string>();
    const entries: string[] = [];

    for (const lib of libraries) {
      const abs = path.resolve(lib.artifact.file);
      if (seen.has(abs)) continue;
      seen.add(abs);
      entries.push(abs);
    }

    const clientAbs = path.resolve(clientJarPath);
    if (!seen.has(clientAbs)) {
      entries.push(clientAbs);
    }

    void this.librariesDir; // entries are already absolute under the shared store

    return {
      entries,
      classpath: entries.join(os === "windows" ? ";" : ":"),
    };
  }
}
