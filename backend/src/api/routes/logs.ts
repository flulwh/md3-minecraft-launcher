import type { FastifyInstance } from "fastify";
import { AppContainer } from "../../container.js";
import { ok } from "../respond.js";
import { listLogsQuerySchema } from "../schemas/index.js";
import { parseQuery } from "./health.js";

export async function logsRoutes(app: FastifyInstance, c: AppContainer): Promise<void> {
  app.get("/api/v1/system/logs", async (req, reply) => {
    const q = parseQuery(listLogsQuerySchema, req.query);
    const logs = c.logs.list({
      ...(q.level !== undefined ? { level: q.level } : {}),
      ...(q.limit !== undefined ? { limit: q.limit } : {}),
      ...(q.afterId !== undefined ? { afterId: q.afterId } : {}),
    });
    return ok(reply, { logs });
  });

  app.delete("/api/v1/system/logs", async (_req, reply) => {
    c.logs.clear();
    return ok(reply, { cleared: true, remain: c.logs.size });
  });
}