import type { FastifyInstance } from "fastify";
import { AppContainer } from "../../container.js";
import { ok } from "../respond.js";
import { updateSettingsSchema } from "../schemas/index.js";
import { parseBody } from "./health.js";

export async function settingsRoutes(app: FastifyInstance, c: AppContainer): Promise<void> {
  app.get("/api/v1/settings", async (_req, reply) => {
    return ok(reply, await c.settings.getAll());
  });

  app.put("/api/v1/settings", async (req, reply) => {
    const body = parseBody(updateSettingsSchema, req.body);
    const result = await c.settings.update(body);

    // Apply concurrency change to the running download manager.
    if (body.downloadConcurrency !== undefined) {
      c.downloadManager.setConcurrency(body.downloadConcurrency);
    }

    return ok(reply, result);
  });
}
