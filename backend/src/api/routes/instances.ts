import type { FastifyInstance } from "fastify";
import { AppContainer } from "../../container.js";
import { ok } from "../respond.js";
import { createInstanceSchema, patchInstanceSchema, idParamSchema, repairSchema } from "../schemas/index.js";
import { parseBody } from "./health.js";
import { z } from "zod";
import { Events } from "../../websocket/events.js";

export async function instanceRoutes(app: FastifyInstance, c: AppContainer): Promise<void> {
  app.get("/api/v1/instances", async (_req, reply) => {
    return ok(reply, await c.instances.list());
  });

  app.post("/api/v1/instances", async (req, reply) => {
    const body = parseBody(createInstanceSchema, req.body);
    const instance = await c.instances.create(body);
    // Background install: state machine drives analyze -> plan -> prepare (loader)
    // -> download -> install (auto deps) -> finalize -> READY.
    try {
      c.installs.start(instance.id);
    } catch (err) {
      c.logger.warn({ instanceId: instance.id, err }, "install start failed");
      c.bus.publish(
        Events.PROVISIONING_FAILED,
        { instanceId: instance.id, error: err instanceof Error ? err.message : String(err) },
        instance.id,
      );
    }
    return ok(reply, instance, 201);
  });

  /** POST /api/v1/instances/:id/plan — builds an install plan (no downloads). */
  app.post("/api/v1/instances/:id/plan", async (req, reply) => {
    const params = parseBody(idParamSchema as unknown as z.ZodType<{ id: string }>, req.params);
    const instance = await c.instances.get(params.id);
    return ok(reply, await c.installs.plan(instance));
  });

  /** GET /api/v1/instances/:id/install — current install snapshot (or null). */
  app.get("/api/v1/instances/:id/install", async (req, reply) => {
    const params = parseBody(idParamSchema as unknown as z.ZodType<{ id: string }>, req.params);
    return ok(reply, c.installs.snapshot(params.id));
  });

  /** POST /api/v1/instances/:id/install — start (or restart) the install. */
  app.post("/api/v1/instances/:id/install", async (req, reply) => {
    const params = parseBody(idParamSchema as unknown as z.ZodType<{ id: string }>, req.params);
    c.installs.start(params.id);
    return ok(reply, { started: true });
  });

  /** POST /api/v1/instances/:id/install/pause */
  app.post("/api/v1/instances/:id/install/pause", async (req, reply) => {
    const params = parseBody(idParamSchema as unknown as z.ZodType<{ id: string }>, req.params);
    c.installs.pause(params.id);
    return ok(reply, { paused: true });
  });

  /** POST /api/v1/instances/:id/install/resume */
  app.post("/api/v1/instances/:id/install/resume", async (req, reply) => {
    const params = parseBody(idParamSchema as unknown as z.ZodType<{ id: string }>, req.params);
    c.installs.resume(params.id);
    return ok(reply, { resumed: true });
  });

  /** POST /api/v1/instances/:id/install/cancel */
  app.post("/api/v1/instances/:id/install/cancel", async (req, reply) => {
    const params = parseBody(idParamSchema as unknown as z.ZodType<{ id: string }>, req.params);
    c.installs.cancel(params.id);
    return ok(reply, { cancelled: true });
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
