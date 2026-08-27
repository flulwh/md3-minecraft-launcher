import fs from "node:fs";
import path from "node:path";
import { Logger } from "../../config/logger.js";
import { InstanceService } from "../../services/instance-service.js";
import { MarketService } from "../market/market-service.js";
import type { MarketProviderId } from "../market/models/market-item.js";
import type { MarketVersion } from "../market/models/market-version.js";
import { ContentManager } from "./content-service.js";

interface LoaderDependency {
  provider: MarketProviderId;
  projectId: string;
  name: string;
  /** The loader name as reported by Modrinth (e.g. "fabric", "quilt"). */
  modrinthLoader: string;
}

/**
 * Maps each mod loader to the essential API mod that should be auto-installed
 * when a new instance is created.  Loaders not listed here (including vanilla,
 * forge, neoforge) ship their API inside the loader JAR and need nothing extra.
 */
const LOADER_DEPENDENCIES: Record<string, LoaderDependency> = {
  fabric: { provider: "modrinth", projectId: "P7dR8mSH", name: "Fabric API", modrinthLoader: "fabric" },
  quilt: { provider: "modrinth", projectId: "qvIfYCYJ", name: "QSL / QFAPI", modrinthLoader: "quilt" },
};

/**
 * Automatically installs the core API mod for a loader (e.g. Fabric API for
 * Fabric instances) so the instance is immediately ready for mod usage.
 *
 * Errors are logged and swallowed — a failure here must never block instance
 * creation.
 */
export class AutoDependencyService {
  constructor(
    private readonly instances: InstanceService,
    private readonly market: MarketService,
    private readonly content: ContentManager,
    private readonly logger: Logger,
  ) {}

  async installForInstance(
    instanceId: string,
    minecraftVersion: string,
    loader: string,
  ): Promise<void> {
    const dep = LOADER_DEPENDENCIES[loader];
    if (!dep) return;

    try {
      await this.doInstall(instanceId, minecraftVersion, dep);
    } catch (err) {
      this.logger.warn(
        { instanceId, loader, projectId: dep.projectId, err },
        "auto-dependency install failed (non-blocking)",
      );
    }
  }

  private async doInstall(
    instanceId: string,
    minecraftVersion: string,
    dep: LoaderDependency,
  ): Promise<void> {
    const versions = await this.market.versions(dep.provider, dep.projectId);
    const match = this.findBestVersion(versions, minecraftVersion, dep.modrinthLoader);
    if (!match) {
      this.logger.debug(
        { projectId: dep.projectId, mcVersion: minecraftVersion },
        "no compatible auto-dependency version found; skipping",
      );
      return;
    }

    // Skip if already installed (file already in mods/).
    const gameDir = this.instances.gameDirectory(instanceId);
    const modsDir = path.join(gameDir, ".minecraft", "mods");
    if (this.isFileInstalled(modsDir, match.fileName)) {
      this.logger.debug(
        { projectId: dep.projectId, fileName: match.fileName },
        "auto-dependency already installed; skipping",
      );
      return;
    }

    // Ensure the mods directory exists so downloadMarketFile can write into it.
    fs.mkdirSync(modsDir, { recursive: true });

    this.logger.info(
      { instanceId, projectId: dep.projectId, name: dep.name, version: match.versionName },
      "installing auto-dependency",
    );
    await this.content.installMarket(
      instanceId,
      dep.provider,
      dep.projectId,
      match.id,
    );
  }

  /** Pick the latest version compatible with the given MC version and loader. */
  private findBestVersion(
    versions: MarketVersion[],
    minecraftVersion: string,
    modrinthLoader: string,
  ) {
    const compatible = versions.filter(
      (v) =>
        v.minecraftVersions.includes(minecraftVersion) &&
        (v.loader === null || v.loader === modrinthLoader),
    );
    // Prefer release dates (newest first), fall back to array order.
    compatible.sort((a, b) => {
      const da = a.releaseDate ?? "";
      const db = b.releaseDate ?? "";
      return db.localeCompare(da);
    });
    return compatible[0] ?? null;
  }

  /** Check whether a .jar with the given name already exists in the directory. */
  private isFileInstalled(dir: string, fileName: string): boolean {
    try {
      const entries = fs.readdirSync(dir);
      return entries.some(
        (e) => e === fileName || e === `${fileName}.disabled`,
      );
    } catch {
      return false;
    }
  }
}
