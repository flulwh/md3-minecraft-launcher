/** Uniform content taxonomy across all market providers. */
export type MarketContentType =
  | "mod"
  | "modpack"
  | "resourcepack"
  | "shader"
  | "world";

export type MarketProviderId = "modrinth" | "curseforge";

/** Lightweight project card used by search results and home feeds. */
export interface MarketItemSummary {
  /** provider-internal id */
  id: string;
  provider: MarketProviderId;
  name: string;
  type: MarketContentType;
  slug: string | null;
  description: string | null;
  author: string | null;
  iconUrl: string | null;
  website: string | null;
  downloads: number;
}