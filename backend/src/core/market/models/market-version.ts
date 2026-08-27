import type { MarketProviderId } from "./market-item.js";

export interface MarketVersionHash {
  algorithm: "sha1" | "sha512";
  value: string;
}

export interface MarketVersionDependency {
  dependencyId: string;
  name: string | null;
  versionId: string | null;
}

/** A single downloadable release of a project (e.g. Sodium 0.5.11 for 1.21). */
export interface MarketVersion {
  id: string;
  provider: MarketProviderId;
  itemId: string;
  versionName: string;
  minecraftVersions: string[];
  loader: string | null;
  fileUrl: string;
  fileName: string;
  fileSize: number;
  hash: MarketVersionHash | null;
  dependencies: MarketVersionDependency[];
  releaseDate: string | null;
}