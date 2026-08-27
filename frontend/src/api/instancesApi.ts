import { http } from "./http";
import type {
  InstanceCreateInput,
  InstanceDto,
  InstancePatchInput,
  InstallationPlan,
  InstallationSnapshot,
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
};
