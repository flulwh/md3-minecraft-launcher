import fs from "node:fs";
import path from "node:path";
import { AppConfig } from "../config/env.js";
import { Logger } from "../config/logger.js";
import { InstanceService } from "../services/instance-service.js";
import { assertInside } from "../utils/paths.js";

export interface ExportManifest {
  format: "md3-instance";
  version: 1;
  instanceId: string;
  name: string;
  minecraftVersion: string;
  loader: string;
  loaderVersion: string | null;
  exportedAt: string;
}

export interface ExportResult {
  fileName: string;
  sizeBytes: number;
  path: string;
}

/**
 * Exports an instance to a self-contained `.zip` package. The archive carries
 * a `pack.json` manifest (reconstructing DB-backed settings) plus the instance
 * directory contents, so it round-trips through ImportManager on any machine.
 */
export class ExportManager {
  constructor(
    private readonly config: AppConfig,
    private readonly instances: InstanceService,
    private readonly logger: Logger,
  ) {}

  async exportInstance(instanceId: string): Promise<ExportResult> {
    const inst = await this.instances.get(instanceId);
    await this.instances.assertIdle(instanceId);

    const src = path.join(this.config.instancesDir, instanceId);
    assertInside(this.config.instancesDir, src);
    if (!fs.existsSync(src)) {
      throw new Error(`Instance directory missing: ${src}`);
    }

    const manifest: ExportManifest = {
      format: "md3-instance",
      version: 1,
      instanceId,
      name: inst.name,
      minecraftVersion: inst.minecraftVersion,
      loader: inst.loader,
      loaderVersion: inst.loaderVersion,
      exportedAt: new Date().toISOString(),
    };

    const fileName = `${sanitizeFileName(inst.name)}-${stamp()}.zip`;
    const destDir = path.join(this.config.exportsDir, instanceId);
    assertInside(this.config.exportsDir, destDir);
    fs.mkdirSync(destDir, { recursive: true });
    const dest = path.join(destDir, fileName);
    assertInside(this.config.exportsDir, dest);

    this.logger.info({ instanceId, fileName }, "export starting");

    const AdmZip = (await import("adm-zip")).default;
    const zip = new AdmZip();
    zip.addFile("pack.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf8"));
    zip.addLocalFolder(src);
    zip.writeZip(dest);

    const stat = fs.statSync(dest);
    this.logger.info({ instanceId, fileName, sizeBytes: stat.size }, "export completed");
    return { fileName, sizeBytes: stat.size, path: dest };
  }
}

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[^\w\u4e00-\u9fa5.-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || "instance";
}

function stamp(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}