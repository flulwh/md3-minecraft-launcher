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

  /** GET /api/v1/launch/profile?instanceId=&accountId= — structured launch profile */
  app.get("/api/v1/launch/profile", async (req, reply) => {
    const q = req.query as { instanceId?: string; accountId?: string; skipPreflight?: string };
    if (typeof q.instanceId !== "string" || typeof q.accountId !== "string") {
      return reply.code(400).send({ error: "instanceId and accountId are required query params" });
    }
    const skipPreflight = q.skipPreflight === "1" || q.skipPreflight === "true";
    const result = await c.launch.launch({
      instanceId: q.instanceId,
      accountId: q.accountId,
      dryRun: true,
      ...(skipPreflight ? { skipPreflight } : {}),
    });
    return ok(reply, { profile: result.profile, compatibility: result.compatibility, removedJvmArgs: result.removedJvmArgs });
  });

  /** GET /api/v1/launch/sessions?live=1 — live processes or persisted history */
  app.get("/api/v1/launch/sessions", async (req, reply) => {
    const q = req.query as { live?: string };
    if (q.live === "1" || q.live === "true") {
      return ok(reply, { live: true, sessions: c.launch.listSessions() });
    }
    return ok(reply, { live: false, sessions: await c.launch.recentSessions() });
  });

  /** GET /api/v1/launch/sessions/:sessionId/incident — Process-Supervisor diagnosis */
  app.get("/api/v1/launch/sessions/:sessionId/incident", async (req, reply) => {
    const params = parseBody(sessionActionSchema, req.params);
    const proc = c.processes.get(params.sessionId);
    if (!proc) return reply.code(404).send({ error: "session not found" });
    const report = proc.crashReportPath;
    let reportContent: string | null = null;
    if (report) {
      try {
        reportContent = await import("node:fs/promises").then((fs) => fs.readFile(report, "utf8"));
      } catch {
        reportContent = null;
      }
    }
    return ok(reply, {
      status: proc.status,
      exitCode: proc.exitCode,
      crashReason: proc.crashReason,
      diagnosis: proc.diagnosis ?? null,
      crashReportPath: report,
      crashReport: reportContent,
    });
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
