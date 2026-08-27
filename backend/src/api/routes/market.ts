import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppContainer } from "../../container.js";
import { ok } from "../respond.js";
import { ValidationError } from "../../errors/index.js";
import { parseBody } from "./health.js";
import type { MarketProviderId } from "../../core/market/index.js";
import type { MarketContentType } from "../../core/market/index.js";

const providerSchema = z.enum(["modrinth", "curseforge"]).default("modrinth");

const installSchema = z.object({
  instanceId: z.string().min(1),
  provider: providerSchema,
  projectId: z.string().min(1),
  versionId: z.string().min(1),
});

const uninstallSchema = z.object({
  instanceId: z.string().min(1),
  provider: providerSchema,
  projectId: z.string().min(1),
});

const searchQuerySchema = z.object({
  q: z.string().min(1).max(200).default(""),
  type: z.enum(["mod", "modpack", "resourcepack", "shader", "world"]).optional(),
  loader: z.string().max(50).optional(),
  mcVersion: z.string().max(20).optional(),
  categories: z.string().max(200).optional(),
  index: z.enum(["relevance", "downloads", "updated"]).default("relevance"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** "a,b,c" → ["a","b","c"], compacting empties. */
function splitList(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  const out = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return out.length > 0 ? out : undefined;
}

export async function marketRoutes(app: FastifyInstance, c: AppContainer): Promise<void> {
  /** GET /api/v2/market/home — featured / popular / updated feeds (optionally scoped to an instance) */
  app.get("/api/v2/market/home", async (req, reply) => {
    const query = req.query as Record<string, string | undefined>;
    const { provider } = parseBody(
      z.object({ provider: providerSchema }),
      { provider: query.provider ?? "modrinth" },
    );
    const options: { mcVersion?: string; loader?: string; categories?: string[] } = {};
    if (query.mcVersion) options.mcVersion = query.mcVersion;
    if (query.loader) options.loader = query.loader;
    const homeCategories = splitList(query.categories);
    if (homeCategories) options.categories = homeCategories;
    return ok(reply, await c.market.home(provider as MarketProviderId, options));
  });

  /** GET /api/v2/market/search?q=&type=&loader=&mcVersion=&index=&limit= */
  app.get("/api/v2/market/search", async (req, reply) => {
    const q = parseBody(searchQuerySchema, req.query);
    return ok(
      reply,
      await c.market.search("modrinth" as MarketProviderId, {
        query: q.q,
        ...(q.type !== undefined ? { type: q.type as MarketContentType } : {}),
        ...(q.loader ? { loader: q.loader } : {}),
        ...(q.mcVersion ? { mcVersion: q.mcVersion } : {}),
        ...(splitList(q.categories) ? { categories: splitList(q.categories)! } : {}),
        index: q.index,
        limit: q.limit,
      }),
    );
  });

  /** GET /api/v2/market/item/:id — project detail */
  app.get("/api/v2/market/item/:id", async (req, reply) => {
    const params = parseBody(z.object({ id: z.string().min(1) }), req.params);
    const { provider, type } = parseBody(
      z.object({ provider: providerSchema, type: z.enum(["mod", "modpack", "resourcepack", "shader", "world"]).optional() }),
      {
        provider: (req.query as { provider?: string }).provider ?? "modrinth",
        type: (req.query as { type?: string }).type,
      },
    );
    return ok(
      reply,
      await c.market.project(provider as MarketProviderId, params.id, type as MarketContentType | undefined),
    );
  });

  /** GET /api/v2/market/item/:id/versions — all releases */
  app.get("/api/v2/market/item/:id/versions", async (req, reply) => {
    const params = parseBody(z.object({ id: z.string().min(1) }), req.params);
    const { provider } = parseBody(
      z.object({ provider: providerSchema }),
      { provider: (req.query as { provider?: string }).provider ?? "modrinth" },
    );
    return ok(reply, await c.market.versions(provider as MarketProviderId, params.id));
  });

  app.get("/api/v2/market/providers", async (_req, reply) => {
    // Capability probe: only list providers that are actually implemented, so
    // UIs never offer a "CurseForge" option that would 501 on every request.
    return ok(reply, c.market.availableProviders());
  });

  /** POST /api/v2/market/install — download a release into an instance & track it */
  app.post("/api/v2/market/install", async (req, reply) => {
    const body = parseBody(installSchema, req.body);
    const result = await c.content.installMarket(
      body.instanceId,
      body.provider as MarketProviderId,
      body.projectId,
      body.versionId,
    );
    return ok(reply, result, 201);
  });

  /** POST /api/v2/market/uninstall — remove an installed market project from an instance */
  app.post("/api/v2/market/uninstall", async (req, reply) => {
    const body = parseBody(uninstallSchema, req.body);
    const removed = await c.content.uninstallMarket(
      body.instanceId,
      body.provider as MarketProviderId,
      body.projectId,
    );
    return ok(reply, { removed });
  });

  /** GET /api/v2/instances/:id/market-installed — list marketplace content in an instance */
  app.get("/api/v2/instances/:id/market-installed", async (req, reply) => {
    const params = parseBody(z.object({ id: z.string().min(1) }), req.params);
    return ok(reply, await c.content.listMarket(params.id));
  });
}