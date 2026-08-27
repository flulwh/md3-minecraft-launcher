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

export type ChecksumAlgorithm = "sha1" | "sha512";

export interface DownloadRequest {
  /** ordered candidate URLs (mirrors); first success wins */
  urls: string[];
  dest: string;
  /** legacy sha1; equivalent to `checksum: { algorithm: "sha1", value }` */
  sha1?: string;
  /** generic integrity checksum (e.g. Modrinth's sha512) */
  checksum?: { algorithm: ChecksumAlgorithm; value: string };
  size?: number;
  kind: DownloadKind;
  /** source label, e.g. official | bmclapi | modrinth | curseforge */
  provider?: string;
  /** lower runs first; scheduler is FIFO otherwise (reserved for later) */
  priority?: number;
  /** e.g. instanceId or version id, used for WS event routing */
  context?: Record<string, unknown>;
}

export interface DownloadProgress {
  taskId: string;
  kind: DownloadKind;
  receivedBytes: number;
  totalBytes: number | null;
  progressPct: number;
  speedBps: number;
  etaSec: number | null;
}

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
  /** primary source URL (first candidate) */
  url?: string;
  /** full ordered candidate list (mirrors) for resume */
  urls?: string[];
  provider?: string;
  priority?: number;
  hashAlgorithm?: string;
  hashValue?: string;
  retryCount: number;
}
