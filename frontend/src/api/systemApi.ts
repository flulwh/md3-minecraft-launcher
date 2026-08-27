import { http } from "./http";
import type {
  JavaRecommendation,
  JavaRuntime,
  JavaScanResult,
  LoaderMeta,
  LoaderVersionsResponse,
  VersionDescribeResponse,
  VersionsListResponse,
} from "./types";

export interface VersionsFilter {
  type?: "release" | "snapshot" | "old_beta" | "old_alpha" | "all";
  limit?: number;
  offset?: number;
}

export type SysLogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

export interface SystemLogEntry {
  id: number;
  time: number;
  level: SysLogLevel;
  text: string;
  module?: string;
}

export const logsApi = {
  list: (params: { level?: SysLogLevel; limit?: number; afterId?: number } = {}): Promise<{ logs: SystemLogEntry[] }> => {
    const sp = new URLSearchParams();
    if (params.level) sp.set("level", params.level);
    if (params.limit !== undefined) sp.set("limit", String(params.limit));
    if (params.afterId !== undefined) sp.set("afterId", String(params.afterId));
    return http.get(`/api/v1/system/logs?${sp.toString()}`);
  },
  clear: (): Promise<{ cleared: boolean; remain: number }> => http.del("/api/v1/system/logs"),
};

export const versionsApi = {
  list: (filter: VersionsFilter = {}): Promise<VersionsListResponse> => {
    const params = new URLSearchParams();
    if (filter.type) params.set("type", filter.type);
    if (filter.limit !== undefined) params.set("limit", String(filter.limit));
    if (filter.offset !== undefined) params.set("offset", String(filter.offset));
    const qs = params.toString();
    return http.get(`/api/v1/versions${qs ? `?${qs}` : ""}`);
  },
  latest: (): Promise<{ release: string; snapshot: string }> =>
    http.get("/api/v1/versions/latest"),
  describe: (version: string): Promise<VersionDescribeResponse> =>
    http.get(`/api/v1/versions/${encodeURIComponent(version)}`),
};

export const loadersApi = {
  list: (): Promise<LoaderMeta[]> => http.get("/api/v1/loaders"),
  versions: (loader: string, minecraftVersion: string): Promise<LoaderVersionsResponse> =>
    http.get(
      `/api/v1/loaders/${loader}/versions?minecraft=${encodeURIComponent(minecraftVersion)}`,
    ),
};

export const javaApi = {
  runtimes: (): Promise<JavaRuntime[]> => http.get("/api/v1/java/runtimes"),
  scan: (): Promise<JavaScanResult> => http.post("/api/v1/java/scan"),
  recommend: (version: string): Promise<JavaRecommendation> =>
    http.get(`/api/v1/java/recommendations?version=${encodeURIComponent(version)}`),
  validate: (path: string): Promise<JavaRuntime> =>
    http.post("/api/v1/java/validate", { path }),
  add: (path: string): Promise<JavaRuntime> =>
    http.post("/api/v1/java/add", { path }),
  remove: (path: string): Promise<{ removed: boolean }> =>
    http.del("/api/v1/java/remove", { path }),
};
