import type { FastifyInstance } from "fastify";
import { AppContainer } from "../../container.js";
import { ok } from "../respond.js";
import { createInstanceSchema, patchInstanceSchema, idParamSchema, repairSchema } from "../schemas/index.js";
import { parseBody } from "./health.js";
import { z } from "zod";

export async function instanceRoutes(app: FastifyInstance, c: AppContainer): Promise<void> {
  app.get("/api/v1/instances", async (_req, reply) => {
    return ok(reply, await c.instances.list());
  });

  app.post("/api/v1/instances", async (req, reply) => {
    const body = parseBody(createInstanceSchema, req.body);
    const instance = await c.instances.create(body);
    // Background provisioning: install the loader (if any) then download the
    // version's client jar, libraries, natives and assets right after creation.
    void provisionNewInstance(c, instance).catch((err) =>
      c.logger.warn({ instanceId: instance.id, err }, "instance provisioning failed"),
    );
    return ok(reply, instance, 201);
  });

  app.get("/api/v1/instances/:id", async (req, reply) => {
    const params = parseBody(idParamSchema as unknown as z.ZodType<{ id: string }>, req.params);
    return ok(reply, await c.instances.get(params.id));
  });

  app.patch("/api/v1/instances/:id", async (req, reply) => {
    const params = parseBody(idParamSchema as unknown as z.ZodType<{ id: string }>, req.params);
    const body = parseBody(patchInstanceSchema, req.body);
    return ok(reply, await c.instances.update(params.id, body));
  });

  app.delete("/api/v1/instances/:id", async (req, reply) => {
    const params = parseBody(idParamSchema as unknown as z.ZodType<{ id: string }>, req.params);
    await c.instances.delete(params.id);
    return ok(reply, { deleted: true });
  });

  /** POST /api/v1/instances/:id/repair */
  app.post("/api/v1/instances/:id/repair", async (req, reply) => {
    const params = parseBody(idParamSchema as unknown as z.ZodType<{ id: string }>, req.params);
    const body = parseBody(repairSchema, req.body ?? {});
    const report = await c.repair.repair(
      params.id,
      body.deepAssets !== undefined ? { deepAssets: body.deepAssets } : {},
    );
    return ok(reply, report);
  });
}

/**
 * Installs the instance's loader (when present) and provisions all game files
 * for a freshly created instance. Runs in the background so the create request
 * can return immediately; files are downloaded by RepairService which reuses the
 * same idempotent download pipeline as launch.
 */
async function provisionNewInstance(
  c: AppContainer,
  instance: { id: string; minecraftVersion: string; loader: string; loaderVersion: string | null },
): Promise<void> {
  if (instance.loader !== "vanilla" && instance.loaderVersion) {
    const adapter = c.loaders.get(instance.loader);
    if (adapter) {
      await adapter.install(instance.minecraftVersion, instance.loaderVersion);
    }
  }
  await c.repair.repair(instance.id);
}
