export type LoaderId = "vanilla" | "fabric" | "forge" | "neoforge" | "quilt";

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
