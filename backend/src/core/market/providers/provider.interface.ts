import type {
  MarketContentType,
  MarketItemSummary,
  MarketProviderId,
} from "../models/market-item.js";
import type { MarketVersion } from "../models/market-version.js";

export type MarketSortIndex = "relevance" | "downloads" | "updated";

export interface MarketSearchParams {
  query: string;
  type?: MarketContentType;
  loader?: string;
  mcVersion?: string;
  /** Content categories/tags, combined with OR semantics within the provider. */
  categories?: string[];
  index?: MarketSortIndex;
  limit?: number;
}

export interface MarketHomeOptions {
  mcVersion?: string;
  loader?: string;
  categories?: string[];
}

export interface MarketHome {
  featured: MarketItemSummary[];
  popular: MarketItemSummary[];
  updated: MarketItemSummary[];
}

/**
 * The single seam every market source implements. Core (search/detail/version)
 * + richer flows (install/update/uninstall) are orchestrated by MarketService,
 * so providers only ever talk to their upstream API.
 */
export interface MarketProvider {
  readonly id: MarketProviderId;
  /** False when the provider is registered but not implemented/configured. */
  readonly available: boolean;
  search(params: MarketSearchParams): Promise<MarketItemSummary[]>;
  getProject(id: string, type?: MarketContentType): Promise<MarketItemSummary>;
  getVersions(id: string): Promise<MarketVersion[]>;
  getHome(options?: MarketHomeOptions): Promise<MarketHome>;
}