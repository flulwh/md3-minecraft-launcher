import { Logger } from "../../../config/logger.js";
import { HttpClient } from "../../../infrastructure/http/http-client.js";
import type { MarketContentType, MarketItemSummary, MarketProviderId } from "../models/market-item.js";
import type { MarketVersion, MarketVersionDependency } from "../models/market-version.js";
import {
  MarketHome,
  MarketHomeOptions,
  MarketProvider,
  MarketSearchParams,
  MarketSortIndex,
} from "./provider.interface.js";

const BASE = "https://api.modrinth.com/v2";
const TYPE_MAP: Record<string, MarketContentType> = {
  mod: "mod",
  modpack: "modpack",
  resourcepack: "resourcepack",
  shader: "shader",
};

interface ModrinthSearchHit {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  project_type: string;
  downloads: number;
  icon_url: string | null;
  author: string;
}
interface ModrinthSearchResponse { hits: ModrinthSearchHit[]; }
interface ModrinthProject {
  id: string;
  slug: string | null;
  title: string;
  description: string;
  project_type: string;
  downloads: number;
  icon_url: string | null;
  project_link: string | null;
  author: string;
}
interface ModrinthVersionFile {
  url: string;
  filename: string;
  primary?: boolean;
  size: number;
  hashes?: { sha1?: string; sha512?: string };
}
interface ModrinthVersion {
  id: string;
  project_id: string;
  name: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  date_published: string;
  files: ModrinthVersionFile[];
  dependencies: Array<{ project_id: string; version_id: string | null; dependency_type: string }>;
}

export class ModrinthProvider implements MarketProvider {
  readonly id = "modrinth" as MarketProviderId;
  readonly available = true;

  constructor(
    private readonly http: HttpClient,
    private readonly logger: Logger,
  ) {}

  async search(params: MarketSearchParams): Promise<MarketItemSummary[]> {
    const qs = new URLSearchParams({
      query: params.query,
      limit: String(params.limit ?? 20),
      // index is a Modrinth-specific sort knob; safe to set even for relevance.
      index: params.index ?? "relevance",
      facets: this.facets(params.type, params.mcVersion, params.loader, params.categories),
    });
    const res = await this.http.getJson<ModrinthSearchResponse>(`${BASE}/search?${qs.toString()}`);
    return (res.hits ?? []).map((h) => this.toSummary(h));
  }

  async getProject(id: string): Promise<MarketItemSummary> {
    const p = await this.http.getJson<ModrinthProject>(`${BASE}/project/${encodeURIComponent(id)}`);
    return {
      id: p.id,
      provider: this.id,
      name: p.title,
      type: this.mapType(p.project_type),
      slug: p.slug ?? null,
      description: p.description || null,
      author: p.author || null,
      iconUrl: p.icon_url ?? null,
      website: p.project_link ?? null,
      downloads: p.downloads,
    };
  }

  async getVersions(id: string): Promise<MarketVersion[]> {
    const versions = await this.http.getJson<ModrinthVersion[]>(
      `${BASE}/project/${encodeURIComponent(id)}/version`,
    );
    return (versions ?? [])
      .sort((a, b) => b.date_published.localeCompare(a.date_published))
      .map((v) => this.toVersion(v));
  }

  async getHome(options?: MarketHomeOptions): Promise<MarketHome> {
    const base: MarketSearchParams = { query: "", type: "mod" };
    if (options?.loader) base.loader = options.loader;
    if (options?.mcVersion) base.mcVersion = options.mcVersion;
    if (options?.categories && options.categories.length > 0) base.categories = options.categories;
    const [featured, popular, updated] = await Promise.all([
      this.search({ ...base, index: "relevance", limit: 10 }),
      this.search({ ...base, index: "downloads", limit: 10 }),
      this.search({ ...base, index: "updated", limit: 10 }),
    ]);
    return { featured, popular, updated };
  }

  // ---- mapping helpers -----------------------------------------------------

  private toSummary(h: ModrinthSearchHit): MarketItemSummary {
    return {
      id: h.project_id,
      provider: this.id,
      name: h.title,
      type: this.mapType(h.project_type),
      slug: h.slug || null,
      description: h.description || null,
      author: h.author || null,
      iconUrl: h.icon_url ?? null,
      website: null,
      downloads: h.downloads,
    };
  }

  private toVersion(v: ModrinthVersion): MarketVersion {
    const file = (v.files ?? []).find((f) => f.primary) ?? (v.files ?? [])[0];
    const hash = file?.hashes?.sha512
      ? { algorithm: "sha512" as const, value: file.hashes.sha512 }
      : file?.hashes?.sha1
        ? { algorithm: "sha1" as const, value: file.hashes.sha1 }
        : null;
    const dependencies: MarketVersionDependency[] = (v.dependencies ?? []).map((d) => ({
      dependencyId: d.project_id,
      name: null,
      versionId: d.version_id ?? null,
    }));
    return {
      id: v.id,
      provider: this.id,
      itemId: v.project_id,
      versionName: v.version_number || v.name,
      minecraftVersions: v.game_versions ?? [],
      loader: (v.loaders ?? [])[0] ?? null,
      fileUrl: file?.url ?? "",
      fileName: file?.filename ?? "",
      fileSize: file?.size ?? 0,
      hash,
      dependencies,
      releaseDate: v.date_published ?? null,
    };
  }

  private facets(
    type?: MarketContentType,
    mcVersion?: string,
    loader?: string,
    categories?: string[],
  ): string {
    const facets: string[][] = [];
    if (type && this.facetType(type)) facets.push([`project_type:${this.facetType(type)}`]);
    if (mcVersion) facets.push([`versions:${mcVersion}`]);
    if (loader) facets.push([`categories:${loader}`]);
    if (categories && categories.length > 0) facets.push(categories.map((c) => `categories:${c}`));
    return JSON.stringify(facets);
  }

  private facetType(type: MarketContentType): string | null {
    return Object.entries(TYPE_MAP).find(([, v]) => v === type)?.[0] ?? null;
  }

  private mapType(projectType: string): MarketContentType {
    return TYPE_MAP[projectType] ?? "mod";
  }
}