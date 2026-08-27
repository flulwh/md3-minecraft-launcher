import path from "node:path";
import { AppConfig } from "./config/env.js";
import { Logger, createLogger } from "./config/logger.js";
import { HttpClient } from "./infrastructure/http/http-client.js";
import { createCachedFetcher, CachedFetcher } from "./infrastructure/cache/cache.js";
import { Database } from "./infrastructure/database/database.js";
import { EventBus } from "./websocket/events.js";
import { VersionManifestService } from "./core/version/version-manifest.js";
import { VersionMetadataStore } from "./core/version/version-metadata-store.js";
import { VersionResolver } from "./core/version/version-resolver.js";
import { DownloadManager } from "./core/download/download-manager.js";
import { AssetService } from "./core/assets/asset-service.js";
import { YggdrasilAuthService } from "./core/authentication/yggdrasil-auth-service.js";
import { TokenCipher } from "./core/authentication/token-cipher.js";
import { AuthenticationService } from "./core/authentication/authentication-service.js";
import { JavaRuntimeManager } from "./core/java/java-runtime-manager.js";
import { MinecraftProcessManager } from "./core/process/process-manager.js";
import { LoaderRegistry } from "./core/loaders/loader-registry.js";
import { MirrorMode } from "./infrastructure/mirror/mirrors.js";
import { VersionService } from "./services/version-service.js";
import { DownloadService, wireDownloadEvents } from "./services/download-service.js";
import { JavaService } from "./services/java-service.js";
import { InstanceService } from "./services/instance-service.js";
import { LaunchService } from "./services/launch-service.js";
import { RepairService } from "./services/repair-service.js";
import { SettingsService } from "./services/settings-service.js";
import { WebSocketManager } from "./websocket/manager.js";

/**
 * Composition root. Manual DI keeps the dependency graph explicit:
 *   API -> Services -> Core -> Infrastructure
 */
export class AppContainer {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly bus: EventBus;
  readonly http: HttpClient;
  readonly cachedFetcher: CachedFetcher;
  readonly db: Database;
  readonly ws: WebSocketManager;

  readonly manifests: VersionManifestService;
  readonly versionStore: VersionMetadataStore;
  readonly versionResolver: VersionResolver;
  readonly versions: VersionService;

  readonly downloadManager: DownloadManager;
  readonly assets: AssetService;
  readonly downloads: DownloadService;

  readonly yggdrasil: YggdrasilAuthService;
  readonly cipher: TokenCipher;
  readonly auth: AuthenticationService;

  readonly javaManager: JavaRuntimeManager;
  readonly java: JavaService;

  readonly instances: InstanceService;
  readonly processes: MinecraftProcessManager;
  readonly launch: LaunchService;
  readonly loaders: LoaderRegistry;
  readonly repair: RepairService;
  readonly settings: SettingsService;

  constructor(config: AppConfig) {
    this.config = config;
    this.logger = createLogger(config);
    this.bus = new EventBus();
    this.http = new HttpClient(config);
    this.cachedFetcher = createCachedFetcher(this.http, config);
    const dbUrl = config.env.DATABASE_URL.startsWith("file:")
      ? `file:${path.join(config.dataDir, "launcher.db")}`
      : config.env.DATABASE_URL;
    this.db = new Database(this.logger, dbUrl);

    // --- version domain
    this.manifests = new VersionManifestService(
      this.cachedFetcher,
      this.logger.child({ module: "version-manifest" }),
      config.env.MIRROR as MirrorMode,
    );
    this.versionStore = new VersionMetadataStore(config, this.http, this.manifests, this.logger.child({ module: "version-store" }));
    this.versionResolver = new VersionResolver(this.versionStore, this.logger.child({ module: "version-resolver" }));
    this.versions = new VersionService(
      this.manifests,
      this.versionResolver,
      this.versionStore,
      this.logger.child({ module: "version-service" }),
    );

    // --- downloads
    this.downloadManager = new DownloadManager(config, this.http, this.logger.child({ module: "download-manager" }));
    this.assets = new AssetService(
      config,
      this.http,
      this.downloadManager,
      this.logger.child({ module: "assets" }),
      config.env.MIRROR as MirrorMode,
    );
    this.downloads = new DownloadService(
      config,
      this.downloadManager,
      this.assets,
      this.bus,
      this.logger.child({ module: "download-service" }),
      this.http,
      config.env.MIRROR as MirrorMode,
    );
    wireDownloadEvents(this.downloadManager, this.bus);

    // --- authentication
    this.cipher = TokenCipher.create(config.env.LAUNCHER_SECRET, config.dataDir);
    this.yggdrasil = new YggdrasilAuthService(
      this.http,
      config.env.YGG_BASE_URL,
      this.logger.child({ module: "yggdrasil-auth" }),
    );
    this.auth = new AuthenticationService(
      config,
      this.db,
      this.yggdrasil,
      this.cipher,
      this.logger.child({ module: "auth" }),
    );

    // --- java
    this.javaManager = new JavaRuntimeManager(config, this.logger.child({ module: "java-manager" }));
    this.java = new JavaService(this.javaManager, this.db, this.logger.child({ module: "java-service" }));

    // --- loaders (needed by launch + repair to resolve loader version-ids)
    this.loaders = new LoaderRegistry(config, this.http, this.versionStore, this.javaManager, this.logger.child({ module: "loaders" }));

    // --- instances + launch
    this.instances = new InstanceService(config, this.db, this.bus, this.logger.child({ module: "instances" }));
    this.processes = new MinecraftProcessManager(this.bus, this.logger.child({ module: "processes" }));
    this.launch = new LaunchService(
      config,
      this.db,
      this.bus,
      this.versions,
      this.downloads,
      this.java,
      this.instances,
      this.auth,
      this.processes,
      this.logger.child({ module: "launch" }),
      this.loaders,
    );

    // --- repair + settings
    this.repair = new RepairService(
      config,
      this.versions,
      this.downloads,
      this.instances,
      this.assets,
      this.bus,
      this.logger.child({ module: "repair" }),
      this.loaders,
    );
    this.settings = new SettingsService(this.db);

    this.ws = new WebSocketManager(this.bus, this.logger.child({ module: "ws" }));
  }
}
