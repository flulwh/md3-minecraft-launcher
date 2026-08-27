import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppContainer } from "../../container.js";
import { ok } from "../respond.js";
import { parseBody } from "./health.js";
import { ValidationError } from "../../errors/index.js";
import { ContentKind, KIND_BY_ROUTE } from "../../core/content/content-types.js";

const contentParamsSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
});

const contentFileParamsSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  file: z.string().min(1),
});

const toggleSchema = z.object({
  enabled: z.boolean(),
});

export async function contentRoutes(app: FastifyInstance, c: AppContainer): Promise<void> {
  /** GET /instances/:id/content/:kind — list content entries (mods|resourcepacks|shaderpacks) */
  app.get("/api/v1/instances/:id/content/:kind", async (req, reply) => {
    const { id, kind } = parseBody(contentParamsSchema, req.params);
    const contentKind = requireKind(kind);
    return ok(reply, await c.content.list(id, contentKind));
  });

  /** POST /instances/:id/content/:kind/:file/toggle — enable/disable an entry */
  app.post("/api/v1/instances/:id/content/:kind/:file/toggle", async (req, reply) => {
    const { id, kind, file } = parseBody(contentFileParamsSchema, req.params);
    const { enabled } = parseBody(toggleSchema, req.body);
    await c.content.setEnabled(id, requireKind(kind), file, enabled);
    return ok(reply, { toggled: file, enabled });
  });

  /** DELETE /instances/:id/content/:kind/:file — remove an entry (incl. its disabled variant) */
  app.delete("/api/v1/instances/:id/content/:kind/:file", async (req, reply) => {
    const { id, kind, file } = parseBody(contentFileParamsSchema, req.params);
    await c.content.remove(id, requireKind(kind), file);
    return ok(reply, { removed: file });
  });

  /** GET /instances/:id/content/:kind/dir — absolute content directory (for "reveal in folder") */
  app.get("/api/v1/instances/:id/content/:kind/dir", async (req, reply) => {
    const { id, kind } = parseBody(contentParamsSchema, req.params);
    return ok(reply, { dir: await c.content.reveal(id, requireKind(kind)) });
  });

  /** POST /instances/:id/content/:kind/import — upload a local file (multipart) into the folder */
  app.post("/api/v1/instances/:id/content/:kind/import", async (req, reply) => {
    const { id, kind } = parseBody(contentParamsSchema, req.params);
    const data = await req.file();
    if (!data) throw new ValidationError("No file uploaded");
    const savedName = await c.content.import(id, requireKind(kind), data.filename, data.file);
    return ok(reply, { imported: savedName });
  });
}

function requireKind(segment: string): ContentKind {
  const kind = KIND_BY_ROUTE[segment];
  if (!kind) {
    const valid = Object.keys(KIND_BY_ROUTE).join(" | ");
    throw new ValidationError(`Unknown content kind '${segment}' (expected: ${valid})`);
  }
  return kind;
}