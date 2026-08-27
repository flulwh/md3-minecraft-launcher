import { http } from "./http";
import type {
  BackupCreateInput,
  DeleteSummary,
  ExportResult,
  HealthReport,
  ImportResult,
  InstanceBackup,
  InstanceCreateInput,
  InstanceDto,
  InstancePatchInput,
  InstallationPlan,
  InstallationSnapshot,
  RestoreResult,
} from "./types";

export const instancesApi = {
  list: (): Promise<InstanceDto[]> => http.get("/api/v1/instances"),
  get: (id: string): Promise<InstanceDto> => http.get(`/api/v1/instances/${id}`),
  create: (input: InstanceCreateInput): Promise<InstanceDto> =>
    http.post("/api/v1/instances", input),
  update: (id: string, patch: InstancePatchInput): Promise<InstanceDto> =>
    http.patch(`/api/v1/instances/${id}`, patch),
  remove: (id: string): Promise<unknown> => http.del(`/api/v1/instances/${id}`),
  repair: (id: string, deepAssets?: boolean): Promise<{ redownloadedLibraries: number }> =>
    http.post(`/api/v1/instances/${id}/repair`, deepAssets ? { deepAssets } : {}),
  // ---- V2.0 install engine ----
  installPlan: (id: string): Promise<InstallationPlan> =>
    http.post(`/api/v1/instances/${id}/plan`),
  install: (id: string): Promise<{ started: true }> =>
    http.post(`/api/v1/instances/${id}/install`),
  installSnapshot: (id: string): Promise<InstallationSnapshot | null> =>
    http.get(`/api/v1/instances/${id}/install`),
  installPause: (id: string): Promise<{ paused: true }> =>
    http.post(`/api/v1/instances/${id}/install/pause`),
  installResume: (id: string): Promise<{ resumed: true }> =>
    http.post(`/api/v1/instances/${id}/install/resume`),
  installCancel: (id: string): Promise<{ cancelled: true }> =>
    http.post(`/api/v1/instances/${id}/install/cancel`),
  // ---- v2.0 backup / export / import / duplicate ----
  backups: (id: string): Promise<InstanceBackup[]> =>
    http.get(`/api/v1/instances/${id}/backups`),
  createBackup: (id: string, input?: BackupCreateInput): Promise<InstanceBackup> =>
    http.post(`/api/v1/instances/${id}/backup`, input),
  restoreBackup: (id: string, backupId: string): Promise<RestoreResult> =>
    http.post(`/api/v1/instances/${id}/backups/${backupId}/restore`),
  removeBackup: (id: string, backupId: string): Promise<{ deleted: true }> =>
    http.del(`/api/v1/instances/${id}/backups/${backupId}`),
  exportInstance: (id: string): Promise<ExportResult> =>
    http.post(`/api/v1/instances/${id}/export`),
  duplicate: (id: string, name?: string): Promise<InstanceDto> =>
    http.post(`/api/v1/instances/${id}/duplicate`, name ? { name } : {}),
  importInstance: (file: File): Promise<ImportResult> => {
    const form = new FormData();
    form.append("file", file, file.name);
    return http.upload("/api/v1/instances/import", form);
  },
  // ---- Phase 8 health / deletion summary ----
  health: (id: string, deep?: boolean): Promise<HealthReport> =>
    http.get(`/api/v1/instances/${id}/health${deep ? "?deep=true" : ""}`),
  predelete: (id: string): Promise<DeleteSummary> =>
    http.get(`/api/v1/instances/${id}/predelete`),
};
