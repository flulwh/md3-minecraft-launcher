import type { FastifyInstance } from "fastify";
import { AppContainer } from "../../container.js";
import { ValidationError } from "../../errors/index.js";
import { ok } from "../respond.js";

export async function healthRoutes(app: FastifyInstance, c: AppContainer): Promise<void> {
  app.get("/api/v1/health", async (_req, reply) => {
    let dbOk = true;
    try {
      await c.db.client.$queryRaw`SELECT 1`;
    } catch {
      dbOk = false;
    }
    return ok(reply, {
      status: "ok",
      uptimeSec: Math.floor(process.uptime()),
      version: c.config.env.LAUNCHER_VERSION,
      node: process.version,
      components: {
        database: dbOk ? "ok" : "error",
        websocketClients: c.ws.clientCount,
        downloads: c.downloadManager.stats(),
      },
    });
  });
}

export function parseBody<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: { issues: Array<{ message: string; path: Array<string | number | symbol> }> } } }, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success || parsed.data === undefined) {
    const issues = (parsed.error?.issues ?? []).map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new ValidationError("Request body validation failed", { issues });
  }
  return parsed.data;
}

export function parseQuery<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: { issues: Array<{ message: string; path: Array<string | number | symbol> }> } } }, query: unknown): T {
  return parseBody(schema, query);
}
