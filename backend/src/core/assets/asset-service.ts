import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { AppConfig } from "../../config/env.js";
import { Logger } from "../../config/logger.js";
import { HttpClient } from "../../infrastructure/http/http-client.js";
import { DownloadManager } from "../download/download-manager.js";
import { DownloadRequest } from "../download/types.js";
import { sha1File } from "../../utils/hash.js";
import { assertInside } from "../../utils/paths.js";
import { MirrorMode, urlCandidates } from "../../infrastructure/mirror/mirrors.js";

const ASSET_BASES = [
  "https://resources.download.minecraft.net",
];

export interface AssetObject {
  hash: string;
  size: number;
}

export interface AssetIndexContent {
  objects: Record<string, AssetObject>;
  virtual?: boolean;
  map_to_resources?: boolean;
}

/**
 * Owns everything under `assets/`:
 *   indexes/<id>.json          - asset index files
 *   objects/<h2>/<hash>        - content-addressed objects
 *   virtual/<legacy-id>/       - materialized legacy layouts
 *
 * Objects are only considered complete after existence + size (+ optional SHA1)
 * verification.
 */
export class AssetService {
  private readonly mirrorMode: MirrorMode;

  constructor(
    private readonly config: AppConfig,
    private readonly http: HttpClient,
    private readonly downloads: DownloadManager,
    private readonly logger: Logger,
    mirrorMode: MirrorMode = "auto",
  ) {
    this.mirrorMode = mirrorMode;
  }

  assetIndexPath(indexId: string): string {
    const safe = indexId.replace(/[^a-zA-Z0-9._-]/g, "_");
    return path.join(this.config.assetIndexesDir, `${safe}.json`);
  }

  objectPath(hash: string): string {
    return path.join(this.config.assetObjectsDir, hash.slice(0, 2), hash);
  }

  virtualDirFor(indexId: string): string {
    const safe = indexId.replace(/[^a-zA-Z0-9._-]/g, "_");
    return path.join(this.config.assetsDir, "virtual", safe);
  }

  /**
   * Downloads (or reuses) the asset index JSON and validates its SHA1+size
   * against the version metadata.
   */
  async ensureAssetIndex(
    indexMeta: { id: string; url: string; sha1: string; size: number },
  ): Promise<AssetIndexContent> {
    const indexPath = this.assetIndexPath(indexMeta.id);

    const existingValid = await this.isIndexFileValid(indexPath, indexMeta);
    if (!existingValid) {
      fs.mkdirSync(path.dirname(indexPath), { recursive: true });
      this.logger.debug({ indexId: indexMeta.id }, "downloading asset index");
      const outcome = await this.downloads.enqueue({
        urls: [indexMeta.url],
        dest: indexPath,
        sha1: indexMeta.sha1,
        size: indexMeta.size,
        kind: "asset-index",
      }).outcome;
      const result = await outcome;
      if (result.status !== "completed") {
        throw new Error(`Failed to download asset index ${indexMeta.id}: ${result.snapshot.error ?? "unknown"}`);
      }
    }

    const raw: unknown = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    if (
      typeof raw !== "object" ||
      raw === null ||
      !("objects" in raw) ||
      typeof (raw as { objects: unknown }).objects !== "object"
    ) {
      throw new Error(`Malformed asset index ${indexMeta.id}`);
    }
    return raw as AssetIndexContent;
  }

  private async isIndexFileValid(
    file: string,
    meta: { sha1: string; size: number },
  ): Promise<boolean> {
    try {
      const st = fs.statSync(file);
      if (st.size !== meta.size) return false;
      return (await sha1File(file)).toLowerCase() === meta.sha1.toLowerCase();
    } catch {
      return false;
    }
  }

  /** Checks which objects already exist and plans downloads for missing ones. */
  plan(index: AssetIndexContent): {
    totalObjects: number;
    pendingDownloads: number;
    totalBytes: number;
    presentObjects: number;
    requests: DownloadRequest[];
  } {
    const requests: DownloadRequest[] = [];
    let presentObjects = 0;
    let totalBytes = 0;

    for (const [key, obj] of Object.entries(index.objects)) {
      totalBytes += obj.size;
      const dest = this.objectPath(obj.hash);
      assertInside(this.config.assetsDir, dest);
      let exists = false;
      try {
        const st = fs.statSync(dest);
        exists = st.isFile() && st.size === obj.size;
      } catch {
        exists = false;
      }
      if (exists) {
        presentObjects += 1;
        continue;
      }
      const canonical = ASSET_BASES.map((base) => `${base}/${obj.hash.slice(0, 2)}/${obj.hash}`);
      requests.push({
        urls: canonical.flatMap((u) => urlCandidates(u, this.mirrorMode)),
        dest,
        size: obj.size,
        kind: "asset",
        context: { key },
      });
    }

    return {
      totalObjects: Object.keys(index.objects).length,
      pendingDownloads: requests.length,
      totalBytes,
      presentObjects,
      requests,
    };
  }

  /**
   * Ensures every object of an index is present and verified.
   * Emits aggregated progress on the download manager event bus.
   */
  async ensureAssets(
    index: AssetIndexContent,
    indexId: string,
    opts?: { deepVerify?: boolean },
  ): Promise<{ completed: number; failed: number }> {
    // Optional full integrity pass (used by repair).
    if (opts?.deepVerify) {
      await this.deepVerifyAndPrune(index);
      return this.ensureAssets(index, indexId);
    }

    const planned = this.plan(index);
    const batch = await this.downloads.enqueueAll(planned.requests);

    if (this.needsVirtualLayout(index)) {
      await this.materializeVirtual(index, indexId);
    }

    if (batch.failed > 0) {
      this.logger.error({ failed: batch.failed }, "some assets failed to download");
    }

    return { completed: batch.completed, failed: batch.failed };
  }

  private needsVirtualLayout(index: AssetIndexContent): boolean {
    return index.virtual === true || index.map_to_resources === true;
  }

  /**
   * Legacy (< 1.6) resource layout: objects must also exist under
   * assets/virtual/<id>/ preserving their original keys.
   */
  async materializeVirtual(index: AssetIndexContent, indexId: string): Promise<void> {
    const virtualDir = this.virtualDirFor(indexId);
    assertInside(this.config.assetsDir, virtualDir);
    fs.mkdirSync(virtualDir, { recursive: true });

    let copied = 0;
    let skipped = 0;
    for (const [key, obj] of Object.entries(index.objects)) {
      const source = this.objectPath(obj.hash);
      const target = path.join(virtualDir, key);
      assertInside(virtualDir, target);
      try {
        const st = fs.statSync(target);
        if (st.isFile() && st.size === obj.size) {
          skipped += 1;
          continue;
        }
      } catch {
        /* need copy */
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      try {
        fs.copyFileSync(source, target);
        copied += 1;
      } catch (err) {
        this.logger.warn({ err, key }, "virtual asset copy failed");
      }
    }
    this.logger.info({ indexId, copied, skipped }, "materialized legacy asset layout");
  }

  /** Full SHA1 audit of every object; deletes corrupt entries so they redownload. */
  async deepVerifyAndPrune(index: AssetIndexContent): Promise<number> {
    let removed = 0;
    for (const obj of Object.values(index.objects)) {
      const file = this.objectPath(obj.hash);
      try {
        const st = fs.statSync(file);
        if (st.size !== obj.size || (await sha1File(file)) !== obj.hash.toLowerCase()) {
          fs.rmSync(file, { force: true });
          removed += 1;
        }
      } catch {
        /* missing -> will be downloaded later */
      }
    }
    return removed;
  }

  /** Quick checksum helper used by repair for sampled verification. */
  static quickHash(filePath: string): string | null {
    try {
      return crypto.createHash("sha1").update(fs.readFileSync(filePath)).digest("hex");
    } catch {
      return null;
    }
  }
}
