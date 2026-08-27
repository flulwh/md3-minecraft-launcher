import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppContainer } from "../../container.js";
import { ok } from "../respond.js";
import { launchRequestSchema } from "../schemas/index.js";
import { parseBody } from "./health.js";

const sessionActionSchema = z.object({
  sessionId: z.string().min(1),
});

export async function launchRoutes(app: FastifyInstance, c: AppContainer): Promise<void> {
  /** POST /api/v1/launch — build & spawn Minecraft */
  app.post("/api/v1/launch", async (req, reply) => {
    const body = parseBody(launchRequestSchema, req.body);
    const result = await c.launch.launch({
      instanceId: body.instanceId,
      accountId: body.accountId,
      ...(body.dryRun !== undefined ? { dryRun: body.dryRun } : {}),
      ...(body.skipPreflight !== undefined ? { skipPreflight: body.skipPreflight } : {}),
    });
    return ok(reply, result);
  });

  /** POST /api/v1/launch/preview — dry run only (no process spawned) */
  app.post("/api/v1/launch/preview", async (req, reply) => {
    const body = parseBody(launchRequestSchema, req.body);
    const result = await c.launch.launch({
      instanceId: body.instanceId,
      accountId: body.accountId,
      ...(body.skipPreflight !== undefined ? { skipPreflight: body.skipPreflight } : {}),
      dryRun: true,
    });
    return ok(reply, result);
  });

  /** GET /api/v1/launch/sessions?live=1 — live processes or persisted history */
  app.get("/api/v1/launch/sessions", async (req, reply) => {
    const q = req.query as { live?: string };
    if (q.live === "1" || q.live === "true") {
      return ok(reply, { live: true, sessions: c.launch.listSessions() });
    }
    return ok(reply, { live: false, sessions: await c.launch.recentSessions() });
  });

  /** POST /api/v1/launch/sessions/:sessionId/stop */
  app.post("/api/v1/launch/sessions/:sessionId/stop", async (req, reply) => {
    const params = parseBody(sessionActionSchema, req.params);
    const proc = c.processes.get(params.sessionId);
    if (!proc) return ok(reply, { stopped: false });
    return ok(reply, { stopped: c.processes.stop(params.sessionId) });
  });

  /** POST /api/v1/launch/sessions/:sessionId/kill */
  app.post("/api/v1/launch/sessions/:sessionId/kill", async (req, reply) => {
    const params = parseBody(sessionActionSchema, req.params);
    const proc = c.processes.get(params.sessionId);
    if (!proc) return ok(reply, { killed: false });
    return ok(reply, { killed: c.processes.kill(params.sessionId) });
  });
}
