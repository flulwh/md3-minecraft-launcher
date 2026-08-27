import path from "node:path";
import { Logger } from "../../config/logger.js";
import { AppConfig } from "../../config/env.js";
import { HttpClient } from "../../infrastructure/http/http-client.js";
import { MemoryCache, DiskCache } from "../../infrastructure/cache/cache.js";
import { NotFoundError } from "../../errors/index.js";
import type { MarketContentType, MarketItemSummary, MarketProviderId } from "./models/market-item.js";
import type { MarketVersion } from "./models/market-version.js";
import { MarketHome, MarketHomeOptions, MarketProvider, MarketSearchParams, MarketSortIndex } from "./providers/provider.interface.js";
import { ModrinthProvider } from "./providers/modrinth.provider.js";
import { CurseForgeProvider } from "./providers/curseforge.provider.js";

/**
 * Orchestrates all market providers behind a typed cache. Providers only talk to
 * their upstream API; MarketService owns caching (home 10m, search 5m, detail
 * 30m, versions 1h), provider selection and error mapping.
 */
export class MarketService {
  private readonly providers = new Map<MarketProviderId, MarketProvider>();
  private readonly memory = new MemoryCache();
  private readonly disk: DiskCache;

  constructor(
    http: HttpClient,
    config: AppConfig,
    logger: Logger,
  ) {
    this.disk = new DiskCache(path.join(config.cacheDir, "market"));
    this.providers.set("modrinth", new ModrinthProvider(http, logger.child({ module: "modrinth" })));
    this.providers.set("curseforge", new CurseForgeProvider(logger.child({ module: "curseforge" })));
  }

  provider(id: MarketProviderId): MarketProvider {
    const p = this.providers.get(id);
    if (!p) throw new NotFoundError("Market provider", id);
    return p;
  }

  /** Only providers whose backend is actually implemented / configured. */
  availableProviders(): MarketProviderId[] {
    return [...this.providers.entries()]
      .filter(([, p]) => p.available)
      .map(([id]) => id);
  }

  async search(
    id: MarketProviderId,
    params: MarketSearchParams,
  ): Promise<MarketItemSummary[]> {
    const key = cacheKey("search", id, [
      params.query,
      params.type ?? "*",
      params.loader ?? "*",
      params.mcVersion ?? "*",
      (params.categories ?? []).join(","),
      params.index ?? "*",
      String(params.limit ?? 20),
    ]);
    return this.fetch(key, 5 * 60_000, () => this.provider(id).search(params));
  }

  async home(id: MarketProviderId, options?: MarketHomeOptions): Promise<MarketHome> {
    const key = cacheKey("home", id, [
      options?.loader ?? "*",
      options?.mcVersion ?? "*",
      (options?.categories ?? []).join(","),
    ]);
    return this.fetch(key, 10 * 60_000, () => this.provider(id).getHome(options));
  }

  async project(id: MarketProviderId, projectId: string, type?: MarketContentType): Promise<MarketItemSummary> {
    const key = cacheKey("project", id, [projectId, type ?? "*"]);
    return this.fetch(key, 30 * 60_000, () => this.provider(id).getProject(projectId, type));
  }

  async versions(id: MarketProviderId, projectId: string): Promise<MarketVersion[]> {
    const key = cacheKey("versions", id, [projectId]);
    return this.fetch(key, 60 * 60_000, () => this.provider(id).getVersions(projectId));
  }

  /** Memory-first, then network (re-cached), then stale disk as an offline fallback. */
  private async fetch<T>(key: string, ttlMs: number, producer: () => Promise<T>): Promise<T> {
    const mem = this.memory.get<T>(key);
    if (mem !== undefined) return mem;
    try {
      const data = await producer();
      this.memory.set(key, data, ttlMs);
      this.disk.set(key, data);
      return data;
    } catch (err) {
      const stale = this.disk.get<T>(key);
      if (stale !== undefined) return stale;
      throw err;
    }
  }
}

function cacheKey(kind: string, provider: string, parts: string[] = []): string {
  return `market:${kind}:${provider}:${parts.join(":")}`;
}

export type { MarketProvider, MarketSearchParams, MarketSortIndex };
export type { MarketContentType, MarketProviderId, MarketItemSummary } from "./models/market-item.js";
export type { MarketVersion } from "./models/market-version.js"