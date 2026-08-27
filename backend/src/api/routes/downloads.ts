import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppContainer } from "../../container.js";
import { ok } from "../respond.js";
import { taskIdParamSchema } from "../schemas/index.js";
import { ValidationError } from "../../errors/index.js";
import { parseBody } from "./health.js";

const actionParamSchema = z.object({
  taskId: z.string().min(1),
  action: z.enum(["pause", "resume", "cancel"]),
});

export async function downloadRoutes(app: FastifyInstance, c: AppContainer): Promise<void> {
  /** GET /api/v1/downloads — active + recent tasks */
  app.get("/api/v1/downloads", async (_req, reply) => {
    return ok(reply, {
      stats: c.downloads.stats(),
      tasks: c.downloads.listTasks(),
    });
  });

  app.post("/api/v1/downloads/:taskId/:action", async (req, reply) => {
    const params = parseBody(actionParamSchema, req.params);
    let applied = false;
    if (params.action === "pause") applied = c.downloads.pauseTask(params.taskId);
    else if (params.action === "resume") applied = c.downloads.resumeTask(params.taskId);
    else if (params.action === "cancel") applied = c.downloads.cancelTask(params.taskId);
    if (!applied) throw new ValidationError(`Cannot ${params.action} task '${params.taskId}'`);
    return ok(reply, { taskId: params.taskId, action: params.action });
  });
}
