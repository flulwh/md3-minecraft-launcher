import path from "node:path";
import { AppConfig } from "../../config/env.js";
import { Library, ResolvedNativeLibrary, ResolvedLibrary } from "../version/types.js";
import { RuntimeEnvironment } from "../../utils/runtime-env.js";
import { evaluateRules } from "./rule-evaluator.js";
import { legacyLibraryUrls, mavenArtifactPath, parseMavenName } from "./maven.js";

const DEFAULT_NATIVE_EXCLUDES = ["META-INF/"];
const DEFAULT_CLASSIFIER_ARCH = (): string =>
  process.arch === "ia32" ? "32" : "64";

export interface LibraryResolution {
  classpath: ResolvedLibrary[];
  natives: ResolvedNativeLibrary[];
  skipped: Array<{ name: string; reason: string }>;
}

/**
 * Turns raw `libraries[]` into concrete, downloadable, rule-filtered artifacts:
 *  - classpath jars (artifact or legacy maven coordinates)
 *  - native classifier jars for the current OS (+ ${arch} substitution)
 */
export class LibraryResolver {
  constructor(private readonly config: AppConfig) {}

  resolve(libraries: Library[], env: RuntimeEnvironment): LibraryResolution {
    const classpath = new Map<string, ResolvedLibrary>();
    const natives: ResolvedNativeLibrary[] = [];
    const skipped: Array<{ name: string; reason: string }> = [];

    for (const lib of libraries) {
      const name = lib.name ?? "<unnamed-library>";

      if (!evaluateRules(lib.rules, env)) {
        skipped.push({ name, reason: "rules" });
        continue;
      }

      if (lib.natives !== undefined && Object.keys(lib.natives).length > 0) {
        const native = this.resolveNative(lib, env);
        if (native) {
          natives.push(native);
        } else {
          skipped.push({ name, reason: "no native classifier for platform" });
        }
        // Legacy-style native libs are not added to the classpath.
        if (lib.downloads?.artifact === undefined) continue;
      }

      const artifact = this.resolveArtifact(lib);
      if (!artifact) {
        skipped.push({ name, reason: "unresolvable coordinates" });
        continue;
      }

      const existing = classpath.get(artifact.file);
      if (existing === undefined) {
        classpath.set(artifact.file, { name, artifact, kind: "class" });
      }
    }

    return {
      classpath: [...classpath.values()],
      natives,
      skipped,
    };
  }

  private resolveArtifact(lib: Library): { file: string; sha1?: string; size?: number; urls: string[] } | null {
    const modern = lib.downloads?.artifact;
    if (modern) {
      const relPath = modern.path ?? this.pathFromName(lib.name);
      if (!relPath) return null;
      return {
        file: path.join(this.config.librariesDir, relPath),
        ...(modern.sha1 !== undefined ? { sha1: modern.sha1 } : {}),
        ...(modern.size !== undefined ? { size: modern.size } : {}),
        // An empty url means the artifact is produced locally by a loader
        // installer (e.g. Forge's client jar) and must not be downloaded.
        urls: [modern.url].filter((u) => u.length > 0),
      };
    }

    const coords = parseMavenName(lib.name ?? "");
    if (!coords) return null;
    const relPath = mavenArtifactPath(coords);
    return {
      file: path.join(this.config.librariesDir, relPath),
      urls: legacyLibraryUrls(lib, relPath),
    };
  }

  private resolveNative(lib: Library, env: RuntimeEnvironment): ResolvedNativeLibrary | null {
    let classifier = lib.natives?.[env.os];
    if (classifier === undefined || classifier === null) return null;

    // e.g. "natives-windows-${arch}" -> natives-windows-64
    classifier = classifier.replace("${arch}", DEFAULT_CLASSIFIER_ARCH());

    const modernClassifier = lib.downloads?.classifiers?.[classifier];
    let file: string;
    let sha1: string | undefined;
    let size: number | undefined;
    let urls: string[];

    if (modernClassifier) {
      const relPath = modernClassifier.path ?? this.pathFromName(lib.name, classifier);
      if (!relPath) return null;
      file = path.join(this.config.librariesDir, relPath);
      sha1 = modernClassifier.sha1;
      size = modernClassifier.size;
      urls = [modernClassifier.url].filter((u) => u.length > 0);
    } else {
      const coords = parseMavenName(`${lib.name}:${classifier}`);
      if (!coords) return null;
      const relPath = mavenArtifactPath(coords);
      file = path.join(this.config.librariesDir, relPath);
      urls = legacyLibraryUrls(lib, relPath);
    }

    const exclude = [
      ...DEFAULT_NATIVE_EXCLUDES,
      ...(lib.extract?.exclude ?? []),
    ];

    const nativeCoords = parseMavenName(file.split(/[\\/]/).pop() ?? "");
    const targetDirName =
      nativeCoords !== null
        ? `${nativeCoords.artifact}-${nativeCoords.version}-${classifier}`
            .replace(/[^a-zA-Z0-9._-]/g, "_")
        : classifier.replace(/[^a-zA-Z0-9._-]/g, "_");

    return {
      name: lib.name ?? "<unnamed-natives>",
      artifact: {
        file,
        ...(sha1 !== undefined ? { sha1 } : {}),
        ...(size !== undefined ? { size } : {}),
        urls,
      },
      extractExclude: exclude,
      targetDirName,
    };
  }

  /** Fallback relative path derivation when `downloads.artifact.path` is absent. */
  private pathFromName(name: string | undefined, classifier?: string): string | null {
    if (!name) return null;
    const base = `${name}${classifier ? `:${classifier}` : ""}`;
    const coords = parseMavenName(base);
    if (!coords) return null;
    return mavenArtifactPath(coords);
  }
}
