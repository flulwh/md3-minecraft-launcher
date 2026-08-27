import fs from "node:fs";
import path from "node:path";
import yauzl from "yauzl";
import { ResolvedNativeLibrary } from "../version/types.js";

export interface ExtractionResult {
  dir: string;
  extractedFiles: number;
  skippedEntries: number;
}

function wildcardToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

export function buildExclusionMatcher(excludePatterns: string[]): (entryPath: string) => boolean {
  const regexes = excludePatterns.map(wildcardToRegex);
  return (entryPath: string): boolean => {
    const normalized = entryPath.split(path.sep).join("/");
    return regexes.some((re) => re.test(normalized) || re.test(path.posix.basename(normalized)));
  };
}

interface ZipEntry {
  fileName: string;
  uncompressedSize: number;
  externalAttributes: number;
}

/**
 * Extracts a natives JAR into destDir while honouring `extract.exclude`
 * patterns. META-INF and friends never land in the natives directory.
 */
export function extractZipFiltered(
  zipPath: string,
  destDir: string,
  excludePatterns: string[],
): Promise<ExtractionResult> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(err ?? new Error(`Unable to open zip ${zipPath}`));
        return;
      }

      const isExcluded = buildExclusionMatcher(excludePatterns);
      let extractedFiles = 0;
      let skippedEntries = 0;

      const fail = (e: unknown): void => {
        try {
          zipfile.close();
        } catch {
          /* noop */
        }
        reject(e instanceof Error ? e : new Error(String(e)));
      };

      fs.mkdirSync(destDir, { recursive: true });

      const processNext = (): void => {
        zipfile.readEntry();
      };

      zipfile.on("error", fail);
      zipfile.on("end", () => {
        try {
          zipfile.close();
        } catch {
          /* noop */
        }
        resolve({ dir: destDir, extractedFiles, skippedEntries });
      });

      zipfile.on("entry", (entryRaw: yauzl.Entry | null) => {
        if (!entryRaw) {
          processNext();
          return;
        }
        const entry = entryRaw as unknown as ZipEntry;
        const entryName = entry.fileName;
        if (entryName.endsWith("/")) {
          skippedEntries += 1;
          processNext();
          return;
        }
        if (isExcluded(entryName)) {
          skippedEntries += 1;
          processNext();
          return;
        }

        // zip-slip protection
        const targetPath = path.resolve(destDir, entryName);
        if (!targetPath.startsWith(path.resolve(destDir) + path.sep)) {
          skippedEntries += 1;
          processNext();
          return;
        }

        zipfile.openReadStream(entryRaw, (streamErr, readStream) => {
          if (streamErr || !readStream) {
            fail(streamErr ?? new Error(`Cannot read zip entry ${entryName}`));
            return;
          }
          const outFile = path.join(destDir, entryName);
          fs.mkdirSync(path.dirname(outFile), { recursive: true });
          const writeStream = fs.createWriteStream(outFile);
          readStream.pipe(writeStream);
          writeStream.on("error", fail);
          writeStream.on("finish", () => {
            // preserve unix permissions from the zip's external attributes
            const unixMode = (entry.externalAttributes >>> 16) & 0o7777;
            if (unixMode !== 0 && process.platform !== "win32") {
              fs.chmodSync(outFile, unixMode);
            } else if (unixMode !== 0 && (unixMode & 0o111) !== 0 && process.platform === "win32") {
              // no-op on Windows; executability is implicit
              void 0;
            }
            extractedFiles += 1;
            processNext();
          });
        });
      });

      processNext();
    });
  });
}

/**
 * Ensures all resolved native libraries are present and extracted into
 * `nativesDir`. Returns per-library extraction results.
 */
export async function prepareNatives(
  nativeLibs: ResolvedNativeLibrary[],
  nativesDir: string,
  ensureArtifact: (artifact: ResolvedNativeLibrary["artifact"]) => Promise<void>,
): Promise<ExtractionResult[]> {
  fs.mkdirSync(nativesDir, { recursive: true });
  const results: ExtractionResult[] = [];
  for (const lib of nativeLibs) {
    await ensureArtifact(lib.artifact);
    const targetDir = path.join(nativesDir, lib.targetDirName);
    results.push(await extractZipFiltered(lib.artifact.file, targetDir, lib.extractExclude));
  }
  return results;
}
