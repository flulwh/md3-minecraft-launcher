import { JavaRuntime } from "../core/java/java-runtime-manager.js";
import { Database } from "../infrastructure/database/database.js";
import { Logger } from "../config/logger.js";

export interface JavaScanResult {
  runtimes: JavaRuntime[];
  scannedAt: number;
}

/**
 * API-facing facade over runtime detection with DB persistence so the
 * frontend can render available Javas without re-probing constantly.
 */
export class JavaService {
  private cache: JavaScanResult | null = null;

  constructor(
    private readonly manager: import("../core/java/java-runtime-manager.js").JavaRuntimeManager,
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  async scan(): Promise<JavaScanResult> {
    const detected = await this.manager.detectAll();

    // Merge manually-added (explicit) runtimes from the database so they
    // survive cache invalidation and re-scans.
    const explicitRows = await this.db.client.javaRuntimeRecord.findMany({
      where: { source: "explicit" },
    });
    const detectedPaths = new Set(detected.map((r) => r.path.toLowerCase()));
    const explicitRuntimes: JavaRuntime[] = [];
    for (const row of explicitRows) {
      if (detectedPaths.has(row.path.toLowerCase())) continue; // already present
      // Re-probe to get fresh version/arch info; skip if the binary is gone.
      try {
        const rt = await this.manager.probeExplicitPath(row.path);
        explicitRuntimes.push(rt);
      } catch {
        this.logger.debug({ path: row.path }, "explicit java probe failed; keeping DB record");
        explicitRuntimes.push({
          path: row.path,
          majorVersion: row.majorVersion,
          architecture: row.architecture,
          ...(row.vendor ? { vendor: row.vendor } : {}),
          ...(row.versionString ? { versionString: row.versionString } : {}),
          source: "explicit",
        });
      }
    }

    const runtimes = [...detected, ...explicitRuntimes];
    // Final dedup by path (case-insensitive).
    const byPath = new Map<string, JavaRuntime>();
    for (const rt of runtimes) byPath.set(rt.path.toLowerCase(), rt);
    const unique = [...byPath.values()].sort((a, b) => b.majorVersion - a.majorVersion);

    this.cache = { runtimes: unique, scannedAt: Date.now() };

    for (const rt of detected) {
      await this.db.client.javaRuntimeRecord.upsert({
        where: { path: rt.path },
        update: {
          majorVersion: rt.majorVersion,
          architecture: rt.architecture,
          ...(rt.vendor !== undefined ? { vendor: rt.vendor } : {}),
          ...(rt.versionString !== undefined ? { versionString: rt.versionString } : {}),
          lastVerifiedAt: new Date(),
        },
        create: {
          path: rt.path,
          majorVersion: rt.majorVersion,
          architecture: rt.architecture,
          vendor: rt.vendor ?? null,
          versionString: rt.versionString ?? null,
        },
      });
    }

    this.logger.info({ count: unique.length }, "java scan complete");
    return this.cache;
  }

  async list(): Promise<JavaRuntime[]> {
    if (this.cache && Date.now() - this.cache.scannedAt < 5 * 60_000) {
      return this.cache.runtimes;
    }
    return (await this.scan()).runtimes;
  }

  /** Validates an explicit Java path by probing `java -version`. */
  async validatePath(javaPath: string): Promise<JavaRuntime> {
    return this.manager.probeExplicitPath(javaPath);
  }

  /**
   * Validates and persists a manually-added Java path with `source: "explicit"`.
   * Returns the probed runtime info.  Throws if the path is not a working Java.
   */
  async addExplicit(javaPath: string): Promise<JavaRuntime> {
    const rt = await this.manager.probeExplicitPath(javaPath);

    await this.db.client.javaRuntimeRecord.upsert({
      where: { path: rt.path },
      update: {
        majorVersion: rt.majorVersion,
        architecture: rt.architecture,
        vendor: rt.vendor ?? null,
        versionString: rt.versionString ?? null,
        source: "explicit",
        lastVerifiedAt: new Date(),
      },
      create: {
        path: rt.path,
        majorVersion: rt.majorVersion,
        architecture: rt.architecture,
        vendor: rt.vendor ?? null,
        versionString: rt.versionString ?? null,
        source: "explicit",
      },
    });

    // Invalidate cache so the next list() call includes the new entry.
    this.cache = null;

    this.logger.info({ path: rt.path, majorVersion: rt.majorVersion }, "explicit java added");
    return rt;
  }

  /** Removes a manually-added Java path from the database. */
  async removeExplicit(javaPath: string): Promise<void> {
    await this.db.client.javaRuntimeRecord.deleteMany({
      where: { path: javaPath, source: "explicit" },
    });
    this.cache = null;
    this.logger.info({ path: javaPath }, "explicit java removed");
  }

  /** Resolves the java binary to use, honouring an explicit override first. */
  async resolveForLaunch(opts: {
    explicitPath?: string | null;
    requiredMajor?: number;
  }): Promise<JavaRuntime> {
    if (opts.explicitPath) {
      return this.manager.probeExplicitPath(opts.explicitPath);
    }
    const available = await this.list();
    return this.manager.selectForRequirement(available, opts.requiredMajor);
  }

  fallbackMajor(versionId: string): number {
    return this.manager.fallbackMajorFor(versionId);
  }
}
