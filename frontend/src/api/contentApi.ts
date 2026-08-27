import { http } from "./http";
import type { ContentDirResult, ContentEntry, ContentKind } from "./types";

type RouteKind = "mods" | "resourcepacks" | "shaderpacks";

const routeByKind: Record<ContentKind, RouteKind> = {
  mod: "mods",
  resourcepack: "resourcepacks",
  shaderpack: "shaderpacks",
};

export const contentApi = {
  list: (instanceId: string, kind: ContentKind): Promise<ContentEntry[]> =>
    http.get(`/api/v1/instances/${instanceId}/content/${routeByKind[kind]}`),
  toggle: (
    instanceId: string,
    kind: ContentKind,
    fileName: string,
    enabled: boolean,
  ): Promise<{ toggled: string; enabled: boolean }> =>
    http.post(
      `/api/v1/instances/${instanceId}/content/${routeByKind[kind]}/${encodeURIComponent(fileName)}/toggle`,
      { enabled },
    ),
  remove: (instanceId: string, kind: ContentKind, fileName: string): Promise<{ removed: string }> =>
    http.del(`/api/v1/instances/${instanceId}/content/${routeByKind[kind]}/${encodeURIComponent(fileName)}`),
  dir: (instanceId: string, kind: ContentKind): Promise<ContentDirResult> =>
    http.get(`/api/v1/instances/${instanceId}/content/${routeByKind[kind]}/dir`),
  import: (instanceId: string, kind: ContentKind, file: File): Promise<{ imported: string }> => {
    const form = new FormData();
    form.append("file", file, file.name);
    return http.upload(`/api/v1/instances/${instanceId}/content/${routeByKind[kind]}/import`, form);
  },
};