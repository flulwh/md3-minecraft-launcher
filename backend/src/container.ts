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
import { attachDownloadPersistence, resumeInterruptedDownloads } from "./core/download/download-persistence.js";
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
import { InstallationManager } from "./installation/manager.js";
import { SettingsService } from "./services/settings-service.js";
import { BackupManager } from "./instance/BackupManager.js";
import { DuplicateManager } from "./instance/DuplicateManager.js";
import { ExportManager } from "./instance/ExportManager.js";
import { ImportManager } from "./instance/ImportManager.js";
import { ContentManager } from "./core/content/content-service.js";
import { AutoDependencyService } from "./core/content/auto-dependency.js";
import { MarketService } from "./core/market/market-service.js";
import { WebSocketManager } from "./websocket/manager.js";
import { LogBuffer, rootLogBuffer } from "./core/log/log-buffer.js";
import { HealthChecker } from "./instance/HealthChecker.js";

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
  readonly logs: LogBuffer;

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
  readonly installs: InstallationManager;
  readonly settings: SettingsService;
  readonly backups: BackupManager;
  readonly duplicates: DuplicateManager;
  readonly exports: ExportManager;
  readonly imports: ImportManager;
  readonly health: HealthChecker;
  readonly content: ContentManager;
  readonly market: MarketService;
  readonly autoDeps: AutoDependencyService;

  constructor(config: AppConfig) {
    this.config = config;
    this.logger = createLogger(config);
    this.logs = rootLogBuffer;
    this.bus = new EventBus();
    this.http = new HttpClient(config);
    this.cachedFetcher = createCachedFetcher(this.http, config);
    const dbUrl = config.env.DATABASE_URL.startsWith("file:")
      ? `file:${path.join(config.dataDir, "launcher.db")}`
      : config.env.DATABASE_URL;
    this.db = new Database(this.logger, dbUrl);

    // --- settings (needed by download/asset/manifest services for mirror mode)
    this.settings = new SettingsService(this.db);

    // --- version domain
    this.manifests = new VersionManifestService(
      this.cachedFetcher,
      this.logger.child({ module: "version-manifest" }),
      config.env.MIRROR as MirrorMode,
      this.settings,
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
      this.settings,
    );
    this.downloads = new DownloadService(
      config,
      this.downloadManager,
      this.assets,
      this.bus,
      this.logger.child({ module: "download-service" }),
      this.http,
      config.env.MIRROR as MirrorMode,
      this.settings,
    );
    wireDownloadEvents(this.downloadManager, this.bus);
    attachDownloadPersistence(
      this.downloadManager,
      this.db,
      this.logger.child({ module: "download-persistence" }),
    );

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
    this.loaders = new LoaderRegistry(config, this.http, this.versionStore, this.javaManager, this.logger.child({ module: "loaders" }), this.settings);

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

    // --- repair
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

    // --- market (search / detail / versions, cached against upstream rate limits)
    this.market = new MarketService(this.http, config, this.logger.child({ module: "market" }));

    // --- instance backup / restore (needs instances for idle guards)
    this.backups = new BackupManager(
      config,
      this.db,
      this.bus,
      this.instances,
      this.logger.child({ module: "backups" }),
    );

    // --- instance duplicate / export / import (file-transfer domain)
    this.duplicates = new DuplicateManager(
      config,
      this.instances,
      this.bus,
      this.logger.child({ module: "duplicates" }),
    );
    this.exports = new ExportManager(config, this.instances, this.logger.child({ module: "exports" }));
    this.imports = new ImportManager(
      config,
      this.instances,
      this.bus,
      this.logger.child({ module: "imports" }),
    );

    // --- instance health / deletion summary (read-only reporting)
    this.health = new HealthChecker(
      config,
      this.db,
      this.instances,
      this.versions,
      this.downloads,
      this.loaders,
      this.logger.child({ module: "health" }),
    );

    // --- instance content (mods / resource packs / shader packs) + market install
    this.content = new ContentManager(
      config,
      this.db,
      this.instances,
      this.bus,
      this.logger.child({ module: "content" }),
      this.downloadManager,
      this.market,
    );

    // --- auto-dependency installer (Fabric API, QSL, etc.)
    this.autoDeps = new AutoDependencyService(
      this.instances,
      this.market,
      this.content,
      this.logger.child({ module: "auto-deps" }),
    );

    // --- installation engine (state machine + plan + orchestration)
    this.installs = new InstallationManager(
      config,
      this.versions,
      this.downloads,
      this.assets,
      this.loaders,
      this.instances,
      this.autoDeps,
      this.downloadManager,
      this.bus,
      this.logger.child({ module: "installation" }),
    );

    // Wire runtime guards so InstanceService.delete() can refuse to wipe a
    // directory while an install session or live process still exists (#2).
    this.instances.setRuntimeGuards(this.installs, this.processes);

    this.ws = new WebSocketManager(this.bus, this.logger.child({ module: "ws" }));
  }

  /** Rebuilds the download queue from tasks interrupted by a previous shutdown/crash. */
  async resumeDownloads(): Promise<number> {
    return resumeInterruptedDownloads(
      this.downloadManager,
      this.db,
      this.logger.child({ module: "download-resume" }),
    );
  }
}
