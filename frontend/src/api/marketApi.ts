import { http } from "./http";
import type {
  MarketContentType,
  MarketHome,
  MarketItemSummary,
  MarketProviderId,
  MarketSortIndex,
  MarketVersion,
} from "./types";

export interface MarketInstallResult {
  instanceId: string;
  projectId: string;
  projectName: string;
  type: MarketContentType;
  kind: "mod" | "resourcepack" | "shaderpack";
  fileName: string;
  versionName: string;
  installed: string[];
}

export interface MarketInstalledEntry {
  projectId: string;
  provider: MarketProviderId;
  name: string;
  type: string;
  versionName: string;
  fileName: string;
  enabled: boolean;
  installedAt: string;
}

export interface MarketSearchParams {
  q: string;
  type?: MarketContentType;
  loader?: string;
  mcVersion?: string;
  categories?: string[];
  index?: MarketSortIndex;
  limit?: number;
}

export interface MarketHomeParams {
  mcVersion?: string;
  loader?: string;
  categories?: string[];
}

function joinList(values?: string[]): string | undefined {
  return values && values.length > 0 ? values.join(",") : undefined;
}

function query(params: object): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "" && v !== "*") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export const marketApi = {
  home: (params?: MarketHomeParams, provider: MarketProviderId = "modrinth"): Promise<MarketHome> =>
    http.get(`/api/v2/market/home${query({ provider, mcVersion: params?.mcVersion, loader: params?.loader, categories: joinList(params?.categories) })}`),
  search: (params: MarketSearchParams): Promise<MarketItemSummary[]> =>
    http.get(`/api/v2/market/search${query(params)}`),
  item: (
    id: string,
    provider: MarketProviderId = "modrinth",
    type?: MarketContentType,
  ): Promise<MarketItemSummary> =>
    http.get(`/api/v2/market/item/${encodeURIComponent(id)}${query({ provider, type })}`),
  versions: (id: string, provider: MarketProviderId = "modrinth"): Promise<MarketVersion[]> =>
    http.get(`/api/v2/market/item/${encodeURIComponent(id)}/versions${query({ provider })}`),
  providers: (): Promise<MarketProviderId[]> => http.get("/api/v2/market/providers"),
  install: (input: {
    instanceId: string;
    provider: MarketProviderId;
    projectId: string;
    versionId: string;
  }): Promise<MarketInstallResult> => http.post("/api/v2/market/install", input),
  uninstall: (input: {
    instanceId: string;
    provider: MarketProviderId;
    projectId: string;
  }): Promise<{ removed: string[] }> => http.post("/api/v2/market/uninstall", input),
  installed: (instanceId: string): Promise<MarketInstalledEntry[]> =>
    http.get(`/api/v2/instances/${encodeURIComponent(instanceId)}/market-installed`),
};