/** Shared types for the instance installation engine. */

/** Task kinds mirror the design doc's installation_tasks.type vocabulary. */
export type InstallationTaskKind =
  | "VERSION_JSON"
  | "CLIENT"
  | "LIBRARY"
  | "NATIVE"
  | "ASSET_INDEX"
  | "ASSET"
  | "LOADER";

/** One discrete file the install needs (or already has cached). */
export interface InstallationTask {
  /** stable id (absolute destination path) used for progress tracking */
  id: string;
  kind: InstallationTaskKind;
  /** friendly file name shown in the UI */
  name: string;
  /** absolute destination path */
  path: string;
  size: number;
  sha1?: string | null;
  /** true when the file already exists and passed validation (cache hit) */
  cached: boolean;
  priority: number;
}

export interface InstallationPlanLoader {
  type: string;
  version: string;
}

/**
 * Authoritative plan generated up-front so the UI can show a confirmation
 * (Minecraft / loader / total size / already cached / to download) before any
 * bytes are fetched.
 */
export interface InstallationPlan {
  instanceId: string;
  minecraft: string;
  loader?: InstallationPlanLoader;
  /** resolved version id that will be installed */
  versionId: string;
  /** total discrete files considered */
  files: number;
  /** files that still need to be downloaded */
  pendingFiles: number;
  /** bytes those files occupy on disk */
  totalBytes: number;
  /** bytes already present & valid (cache hit) */
  cachedBytes: number;
  /** bytes that will actually be downloaded */
  downloadBytes: number;
  tasks: InstallationTask[];
}