import { http } from "./http";
import type { InstanceCreateInput, InstanceDto, InstancePatchInput } from "./types";

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
};
