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
    const runtimes = await this.manager.detectAll();
    this.cache = { runtimes, scannedAt: Date.now() };

    for (const rt of runtimes) {
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

    this.logger.info({ count: runtimes.length }, "java scan complete");
    return this.cache;
  }

  async list(): Promise<JavaRuntime[]> {
    if (this.cache && Date.now() - this.cache.scannedAt < 5 * 60_000) {
      return this.cache.runtimes;
    }
    return (await this.scan()).runtimes;
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
