export type LoaderId = "vanilla" | "fabric" | "forge" | "neoforge" | "quilt";

/** Directory-scoped instance content that can be listed/toggled/deleted. */
export type ContentKind = "mod" | "resourcepack" | "shaderpack";

export interface ContentEntry {
  fileName: string;
  size: number;
  mtimeMs: number;
  enabled: boolean;
}

export interface ContentDirResult {
  dir: string;
}

export interface ApiEnvelope<T> {
  success: true;
  data: T;
}

export interface ApiErrorEnvelope {
  success: false;
  error: { code: string; message: string; details?: Record<string, unknown> };
}

export interface InstanceDto {
  id: string;
  name: string;
  minecraftVersion: string;
  loader: string;
  loaderVersion: string | null;
  javaPath: string | null;
  memoryMinMb: number | null;
  memoryMaxMb: number;
  jvmArgs: string[];
  gameArgs: Record<string, string>;
  width: number | null;
  height: number | null;
  fullscreen: boolean;
  serverIp: string | null;
  gameDir: string;
  status: string;
  installedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface InstanceCreateInput {
  name: string;
  minecraftVersion: string;
  loader?: LoaderId;
  loaderVersion?: string;
  javaPath?: string;
  memoryMinMb?: number;
  memoryMaxMb?: number;
  jvmArgs?: string[];
  gameArgs?: Record<string, string>;
  width?: number;
  height?: number;
  fullscreen?: boolean;
  serverIp?: string;
}

export type InstancePatchInput = Partial<InstanceCreateInput>;

export interface MinecraftProfileInfo {
  id: string;
  name: string;
}

export interface PublicAccount {
  id: string;
  type: string;
  username: string;
  authServer: string;
  profiles: MinecraftProfileInfo[];
  hasStoredCredentials: boolean;
}

export interface YggdrasilLoginInput {
  username: string;
  password: string;
  profileName?: string;
}

export interface JavaRuntime {
  path: string;
  majorVersion: number;
  architecture: string;
  versionString?: string;
  vendor?: string;
  source: "system" | "managed" | "explicit";
}

export interface JavaScanResult {
  runtimes: JavaRuntime[];
  scannedAt: number;
}

export interface JavaRecommendation {
  versionId: string;
  requiredMajorVersion: number;
  declaredByMetadata: boolean;
  compatible: JavaRuntime[];
}

export type DownloadStatus =
  | "pending"
  | "downloading"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type DownloadKind =
  | "client"
  | "client-mappings"
  | "library"
  | "native"
  | "asset-index"
  | "asset"
  | "log-config"
  | "java-runtime"
  | "loader"
  | "other";

export interface DownloadTaskSnapshot {
  taskId: string;
  kind: DownloadKind;
  dest: string;
  status: DownloadStatus;
  receivedBytes: number;
  totalBytes: number | null;
  progressPct: number;
  speedBps: number;
  etaSec: number | null;
  error?: string;
}

export interface DownloadStats {
  queued: number;
  active: number;
  aggregateSpeedBps: number;
  completedTotal: number;
  failedTotal: number;
}

export interface DownloadsResponse {
  stats: DownloadStats;
  tasks: DownloadTaskSnapshot[];
}

export interface PreflightCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface PreflightResult {
  success: boolean;
  checks: PreflightCheck[];
}

export interface LaunchCommand {
  javaPath: string;
  args: string[];
  cwd: string;
}

export interface LaunchResult {
  sessionId: string | null;
  command: LaunchCommand;
  preflight: PreflightResult;
  pid?: number;
}

export interface LiveSession {
  sessionId: string;
  instanceId: string;
  pid: number | null;
  status: "starting" | "running" | "stopping" | "stopped" | "crashed";
  startedAtMs: number;
  endedAtMs: number | null;
  exitCode: number | null;
}

export interface HistorySession {
  id: string;
  instanceId: string;
  accountId: string;
  pid: number | null;
  status: string;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  crashReason: string | null;
}

export interface SettingsPayload {
  downloadConcurrency?: number;
  defaultMemoryMaxMb?: number;
  preferredJavaPath?: string | null;
  extraJvmArgs?: string[];
  mirrorMode?: "auto" | "official" | "bmclapi";
}

export interface ManifestVersion {
  id: string;
  type: string;
  releaseTime?: string;
  url?: string;
}

export interface VersionsListResponse {
  latest: { release: string; snapshot: string };
  total: number;
  versions: ManifestVersion[];
}

export interface LoaderMeta {
  id: Exclude<LoaderId, "vanilla">;
  displayName: string;
}

export interface LoaderVersion {
  id: string;
  stable: boolean;
}

export interface LoaderVersionsResponse {
  loader: string;
  minecraft: string;
  versions: LoaderVersion[];
}

export interface VersionSummary {
  id: string;
  type: string;
  mainClass: string;
  inheritanceChain: string[];
  libraryCount: number;
  hasAssetIndex: boolean;
  assets?: string;
  javaVersion?: { component: string; majorVersion: number };
  clientSize?: number;
}

export interface VersionDescribeResponse {
  resolved: VersionSummary;
  inheritsFrom: string | null;
}

export interface HealthResponse {
  status: string;
  uptimeSec: number;
  version: string;
  node: string;
  components: {
    database: string;
    websocketClients: number;
    downloads: DownloadStats;
  };
}

export interface EventEnvelope<T = unknown> {
  type: string;
  timestamp: number;
  instanceId?: string;
  data: T;
}

export interface ProvisioningFailedData {
  instanceId: string;
  error: string;
}

export const Events = {
  DOWNLOAD_PROGRESS: "download.progress",
  DOWNLOAD_COMPLETED: "download.completed",
  DOWNLOAD_FAILED: "download.failed",
  REPAIR_PROGRESS: "repair.progress",
  MINECRAFT_STARTING: "minecraft.starting",
  MINECRAFT_STARTED: "minecraft.started",
  MINECRAFT_LOG: "minecraft.log",
  MINECRAFT_EXIT: "minecraft.exit",
  MINECRAFT_CRASH: "minecraft.crash",
  INSTANCE_UPDATED: "instance.updated",
  CONTENT_CHANGED: "content.changed",
  JAVA_SCAN_DONE: "java.scan.done",
  PROVISIONING_FAILED: "provisioning.failed",
  INSTALL: "install.progress",
} as const;

export interface MinecraftLogData {
  level: string;
  message: string;
}

export interface DownloadProgressData {
  taskId: string;
  kind: string;
  progressPct: number;
  receivedBytes: number;
  totalBytes: number | null;
  speedBps: number;
  etaSec: number | null;
}

export interface RepairProgressData {
  instanceId: string;
  stage: string;
  current: number;
  total: number;
}

// ---- instance installation (V2.0 install engine) ----

export type InstallPhase =
  | "CREATED"
  | "ANALYZING"
  | "PLANNING"
  | "PREPARING"
  | "DOWNLOADING"
  | "INSTALLING"
  | "FINALIZING"
  | "READY"
  | "PAUSED"
  | "RETRYING"
  | "CANCELLING"
  | "CANCELLED"
  | "FAILED";

export type InstanceStatus =
  | "CREATED"
  | "INSTALLING"
  | "READY"
  | "BROKEN"
  | "UPDATING"
  | "UNINSTALLING"
  | "DELETED";

export interface InstallationSnapshot {
  instanceId: string;
  phase: InstallPhase;
  instanceStatus: InstanceStatus;
  progressPct: number;
  downloadedBytes: number;
  totalBytes: number;
  speedBps: number;
  etaSec: number | null;
  tasksDone: number;
  tasksTotal: number;
  error?: string;
  message?: string;
  updatedAt: number;
}

export type InstallationTaskKind =
  | "VERSION_JSON"
  | "CLIENT"
  | "LIBRARY"
  | "NATIVE"
  | "ASSET_INDEX"
  | "ASSET"
  | "LOADER";

export interface InstallationTask {
  id: string;
  kind: InstallationTaskKind;
  name: string;
  path: string;
  size: number;
  sha1: string | null;
  cached: boolean;
  priority: number;
}

export interface InstallationPlan {
  instanceId: string;
  minecraft: string;
  loader?: string | null;
  versionId: string;
  files: number;
  pendingFiles: number;
  totalBytes: number;
  cachedBytes: number;
  downloadBytes: number;
  tasks: InstallationTask[];
}

// ---- market ----

export type MarketProviderId = "modrinth" | "curseforge";

export type MarketContentType = "mod" | "modpack" | "resourcepack" | "shader" | "world";

export type MarketSortIndex = "relevance" | "downloads" | "updated";

export interface MarketItemSummary {
  id: string;
  provider: MarketProviderId;
  name: string;
  type: MarketContentType;
  slug: string | null;
  description: string | null;
  author: string | null;
  iconUrl: string | null;
  website: string | null;
  downloads: number;
}

export interface MarketHome {
  featured: MarketItemSummary[];
  popular: MarketItemSummary[];
  updated: MarketItemSummary[];
}

export interface MarketVersionHash {
  algorithm: "sha1" | "sha512";
  value: string;
}

export interface MarketVersionDependency {
  dependencyId: string;
  name: string | null;
  versionId: string | null;
}

export interface MarketVersion {
  id: string;
  provider: MarketProviderId;
  itemId: string;
  versionName: string;
  minecraftVersions: string[];
  loader: string | null;
  fileUrl: string;
  fileName: string;
  fileSize: number;
  hash: MarketVersionHash | null;
  dependencies: MarketVersionDependency[];
  releaseDate: string | null;
}
