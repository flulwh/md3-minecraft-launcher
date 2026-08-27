import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppContainer } from "../../container.js";
import { ok } from "../respond.js";
import { installLoaderSchema } from "../schemas/index.js";
import { ValidationError, NotFoundError } from "../../errors/index.js";
import { parseBody } from "./health.js";

const loaderParamSchema = z.object({ loader: z.string().min(1) });

export async function loaderRoutes(app: FastifyInstance, c: AppContainer): Promise<void> {
  /** GET /api/v1/loaders — supported loaders */
  app.get("/api/v1/loaders", async (_req, reply) => {
    return ok(reply, c.loaders.list());
  });

  /** GET /api/v1/loaders/:loader/versions?minecraft=1.21 */
  app.get("/api/v1/loaders/:loader/versions", async (req, reply) => {
    const params = parseBody(loaderParamSchema, req.params);
    const q = req.query as { minecraft?: string };
    const mc = typeof q.minecraft === "string" ? q.minecraft : "";
    if (mc.length === 0) throw new ValidationError("Query parameter 'minecraft' is required");

    const adapter = c.loaders.get(params.loader);
    if (!adapter) throw new NotFoundError("Loader", params.loader);
    return ok(reply, { loader: adapter.id, minecraft: mc, versions: await adapter.getVersions(mc) });
  });

  /**
   * POST /instances/:id/loader — install a loader onto an existing instance
   * body: { minecraftVersion?, loader, loaderVersion }
   * Updates the instance to reference the installed version profile.
   */
  app.post("/api/v1/instances/:id/loader", async (req, reply) => {
    const params = parseBody(z.object({ id: z.string().min(1) }), req.params);
    const body = parseBody(installLoaderSchema, req.body);
    const instance = await c.instances.require(params.id);

    // loader id comes from the instance itself; minecraftVersion defaults to the instance's
    const adapter = c.loaders.get(instance.loader);
    if (!adapter || instance.loader === "vanilla") {
      throw new ValidationError(
        `Instance loader '${instance.loader}' has no adapter. PATCH the instance loader first.`,
      );
    }
    if (body.minecraftVersion !== instance.minecraftVersion) {
      throw new ValidationError("minecraftVersion does not match this instance");
    }

    const versionId = await adapter.install(body.minecraftVersion, body.loaderVersion);
    await c.instances.update(params.id, { loaderVersion: body.loaderVersion });
    return ok(reply, { instanceId: params.id, installedVersionId: versionId });
  });

  /** DELETE /loaders/:loader/:versionId */
  app.delete("/api/v1/loaders/:loader/:versionId", async (req, reply) => {
    const params = parseBody(
      z.object({ loader: z.string().min(1), versionId: z.string().min(1) }),
      req.params,
    );
    const adapter = c.loaders.get(params.loader);
    if (!adapter) throw new NotFoundError("Loader", params.loader);
    await adapter.uninstall(params.versionId);
    return ok(reply, { removed: params.versionId });
  });
}
