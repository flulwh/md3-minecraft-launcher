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

export interface DownloadRequest {
  /** ordered candidate URLs (mirrors); first success wins */
  urls: string[];
  dest: string;
  sha1?: string;
  size?: number;
  kind: DownloadKind;
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
}
