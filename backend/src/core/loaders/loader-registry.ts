import { Logger } from "../../config/logger.js";
import { HttpClient } from "../../infrastructure/http/http-client.js";
import { AppConfig } from "../../config/env.js";
import { VersionMetadataStore } from "../version/version-metadata-store.js";
import { JavaRuntimeManager } from "../java/java-runtime-manager.js";
import { ModLoaderAdapter } from "./mod-loader-adapter.js";
import { FabricAdapter, QuiltAdapter } from "./meta-profile-adapters.js";
import { ForgeAdapter, NeoForgeAdapter } from "./installer-adapters.js";
import type { SettingsService } from "../../services/settings-service.js";

export class LoaderRegistry {
  private readonly adapters = new Map<string, ModLoaderAdapter>();

  constructor(config: AppConfig, http: HttpClient, store: VersionMetadataStore, javaManager: JavaRuntimeManager, logger: Logger, settings?: SettingsService) {
    const fabric = new FabricAdapter(config, http, store, logger, settings);
    const quilt = new QuiltAdapter(config, http, store, logger, settings);
    const forge = new ForgeAdapter(config, http, store, javaManager, logger, settings);
    const neoforge = new NeoForgeAdapter(config, http, store, javaManager, logger, settings);
    for (const a of [fabric, forge, neoforge, quilt]) this.adapters.set(a.id, a);
  }

  get(id: string): ModLoaderAdapter | undefined {
    return this.adapters.get(id);
  }

  list(): Array<Pick<ModLoaderAdapter, "id" | "displayName">> {
    return [...this.adapters.values()].map((a) => ({ id: a.id, displayName: a.displayName }));
  }
}
