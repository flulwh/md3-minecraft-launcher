import type { FastifyInstance } from "fastify";
import { AppContainer } from "../../container.js";
import { ok } from "../respond.js";
import { listVersionsQuerySchema, versionParamSchema } from "../schemas/index.js";
import { parseQuery } from "./health.js";

export async function versionRoutes(app: FastifyInstance, c: AppContainer): Promise<void> {
  /** GET /api/v1/versions?type=&limit=&offset= */
  app.get("/api/v1/versions", async (req, reply) => {
    const query = parseQuery(listVersionsQuerySchema, req.query);
    const result = await c.versions.list(query);
    return ok(reply, result);
  });

  /** GET /api/v1/versions/latest */
  app.get("/api/v1/versions/latest", async (_req, reply) => {
    return ok(reply, await c.versions.latest());
  });

  /**
   * GET /api/v1/versions/:version
   * Returns the fully resolved (inheritance-merged) summary.
   */
  app.get("/api/v1/versions/:version", async (req, reply) => {
    const params = parseQuery(versionParamSchema, req.params);
    const [summary, raw] = await Promise.all([
      c.versions.describe(params.version),
      c.versions.raw(params.version),
    ]);
    return ok(reply, {
      resolved: summary,
      inheritsFrom: raw.inheritsFrom ?? null,
    });
  });

  /** GET /api/v1/versions/:version/libraries — rule-filtered library list */
  app.get("/api/v1/versions/:version/libraries", async (req, reply) => {
    const params = parseQuery(versionParamSchema, req.params);
    const resolved = await c.versions.resolve(params.version);
    return ok(reply, {
      id: resolved.id,
      inheritanceChain: resolved.inheritanceChain,
      libraries: resolved.libraries.map((l) => ({
        name: l.name ?? "<unnamed>",
        hasNatives: l.natives !== undefined && Object.keys(l.natives).length > 0,
      })),
    });
  });
}
