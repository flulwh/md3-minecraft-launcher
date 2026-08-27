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

  finish(): PreflightResult {
    return {
      success: this.checks.every((c) => c.ok),
      checks: [...this.checks],
    };
  }
}
