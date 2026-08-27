import fs from "node:fs";
import { Logger } from "../../config/logger.js";

export interface PreflightCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface PreflightResult {
  success: boolean;
  checks: PreflightCheck[];
}

/**
 * Pre-launch verification with human-readable results:
 *
 *   ✓ Java 21
 *   ✓ Minecraft 1.21.x
 *   ✗ Java Runtime — no Java 17+ found
 */
export class PreflightChecker {
  constructor(private readonly logger: Logger) {}

  newReport(): ReportBuilder {
    return new ReportBuilder(this.logger);
  }
}

export class ReportBuilder {
  private readonly checks: PreflightCheck[] = [];

  constructor(private readonly logger: Logger) {}

  add(name: string, ok: boolean, detail?: string): this {
    this.checks.push(ok ? { name, ok } : { name, ok, ...(detail !== undefined ? { detail } : {}) });
    const mark = ok ? "✓" : "✗";
    const suffix = !ok && detail ? ` — ${detail}` : "";
    this.logger.info(`${mark} ${name}${suffix}`);
    return this;
  }

  fileExists(name: string, path: string): this {
    let ok = false;
    try {
      ok = fs.statSync(path).isFile();
    } catch {
      ok = false;
    }
    return this.add(name, ok, ok ? undefined : `missing: ${path}`);
  }

  /** Verifies every entry in `paths` resolves to an existing file. */
  pathsExist(name: string, paths: string[], maxShown = 3): this {
    const missing: string[] = [];
    for (const p of paths) {
      let ok = false;
      try {
        ok = fs.statSync(p).isFile();
      } catch {
        ok = false;
      }
      if (!ok) missing.push(p);
    }
    if (missing.length === 0) return this.add(name, true);
    const shown = missing.slice(0, maxShown).join(", ");
    const more = missing.length > maxShown ? ` (+${missing.length - maxShown} more)` : "";
    return this.add(name, false, `missing: ${shown}${more}`);
  }

  /**
   * Verifies a (jar) file exists and that it actually *contains* the given
   * marker entry. Used to prove a loader's patched client is legitimate — a
   * file alone is not enough; Forge looks the marker up inside the classloader.
   */
  async jarMarker(name: string, jarPath: string, marker: string): Promise<this> {
    let ok = false;
    let detail = `missing: ${jarPath}`;
    try {
      if (fs.statSync(jarPath).isFile()) {
        const { readFileSync } = await import("node:fs");
        const AdmZip = (await import("adm-zip")).default;
        const zip = new AdmZip(readFileSync(jarPath));
        if (zip.getEntry(marker) !== null) {
          ok = true;
        } else {
          detail = `marker '${marker}' not found inside ${jarPath}`;
        }
      }
    } catch {
      ok = false;
      detail = `unreadable jar: ${jarPath}`;
    }
    return this.add(name, ok, ok ? undefined : detail);
  }

  finish(): PreflightResult {
    return {
      success: this.checks.every((c) => c.ok),
      checks: [...this.checks],
    };
  }
}
