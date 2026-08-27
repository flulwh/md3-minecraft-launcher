import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { AppContainer } from "../../container.js";
import { ok } from "../respond.js";
import { createInstanceSchema, patchInstanceSchema, idParamSchema, repairSchema, backupSchema, duplicateSchema } from "../schemas/index.js";
import { parseBody } from "./health.js";
import { ValidationError } from "../../errors/index.js";
import { z } from "zod";
import { Events } from "../../websocket/events.js";

export async function instanceRoutes(app: FastifyInstance, c: AppContainer): Promise<void> {
  app.get("/api/v1/instances", async (_req, reply) => {
    return ok(reply, await c.instances.list());
  });

  app.post("/api/v1/instances", async (req, reply) => {
    const body = parseBody(createInstanceSchema, req.body);
    const instance = await c.instances.create(body);
    // Intentionally DO NOT auto-start the install on create. The V2 engine
    // exposes a separate /install + /plan flow so the UI can present the
    // planned download size before the user confirms (#11). Callers that want
    // the old auto-install behaviour can still POST /install after create.
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
    try {
      c.installs.start(params.id);
      return ok(reply, { started: true });
    } catch (err) {
      // Sync failure (e.g. INSTALL_IN_PROGRESS, or start() throwing for an
      // unexpected reason) — surface it as a 4xx/5xx and mark the row BROKEN
      // with lastError so the UI isn't stuck with a misleading CREATED state
      // (#14).
      const msg = err instanceof Error ? err.message : String(err);
      try {
        await c.instances.setStatus(params.id, "BROKEN", { lastError: msg });
      } catch {
        /* best effort; don't mask the original error */
      }
      throw err;
    }
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

  /** GET /api/v1/instances/:id/health — read-only health report (?deep=true audits library hashes). */
  app.get("/api/v1/instances/:id/health", async (req, reply) => {
    const params = parseBody(idParamSchema as unknown as z.ZodType<{ id: string }>, req.params);
    const query = (req.query ?? {}) as Record<string, unknown>;
    const report = await c.health.check(params.id, { deep: query.deep === "true" || query.deep === "1" });
    return ok(reply, report);
  });

  /** GET /api/v1/instances/:id/predelete — summaries for the delete confirmation dialog. */
  app.get("/api/v1/instances/:id/predelete", async (req, reply) => {
    const params = parseBody(idParamSchema as unknown as z.ZodType<{ id: string }>, req.params);
    return ok(reply, await c.health.deleteSummary(params.id));
  });

  /** POST /api/v1/instances/:id/backup — create a manual backup archive. */
  app.post("/api/v1/instances/:id/backup", async (req, reply) => {
    const params = parseBody(idParamSchema as unknown as z.ZodType<{ id: string }>, req.params);
    const body = parseBody(backupSchema, req.body ?? {});
    const backup = await c.backups.create(params.id, {
      ...(body.kind !== undefined ? { kind: body.kind } : {}),
      ...(body.label !== undefined ? { label: body.label } : {}),
    });
    return ok(reply, backup, 201);
  });

  /** GET /api/v1/instances/:id/backups — list backups for a live instance. */
  app.get("/api/v1/instances/:id/backups", async (req, reply) => {
    const params = parseBody(idParamSchema as unknown as z.ZodType<{ id: string }>, req.params);
    return ok(reply, await c.backups.list(params.id));
  });

  /** POST /api/v1/instances/:id/backups/:backupId/restore */
  app.post("/api/v1/instances/:id/backups/:backupId/restore", async (req, reply) => {
    const params = parseBody(
      (z.object({ id: z.string().min(1), backupId: z.string().min(1) })) as unknown as z.ZodType<{ id: string; backupId: string }>,
      req.params,
    );
    return ok(reply, await c.backups.restore(params.id, params.backupId));
  });

  /** DELETE /api/v1/instances/:id/backups/:backupId */
  app.delete("/api/v1/instances/:id/backups/:backupId", async (req, reply) => {
    const params = parseBody(
      (z.object({ id: z.string().min(1), backupId: z.string().min(1) })) as unknown as z.ZodType<{ id: string; backupId: string }>,
      req.params,
    );
    await c.backups.remove(params.backupId);
    return ok(reply, { deleted: true });
  });

  /** POST /api/v1/instances/:id/duplicate — deep-copy an instance (no re-download). */
  app.post("/api/v1/instances/:id/duplicate", async (req, reply) => {
    const params = parseBody(idParamSchema as unknown as z.ZodType<{ id: string }>, req.params);
    const body = parseBody(duplicateSchema, req.body ?? {});
    const instance = await c.duplicates.duplicate(params.id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
    });
    return ok(reply, instance, 201);
  });

  /** POST /api/v1/instances/:id/export — write a self-contained .zip package. */
  app.post("/api/v1/instances/:id/export", async (req, reply) => {
    const params = parseBody(idParamSchema as unknown as z.ZodType<{ id: string }>, req.params);
    return ok(reply, await c.exports.exportInstance(params.id));
  });

  /** POST /api/v1/instances/import — upload a MD3 `.zip` or Modrinth `.mrpack`. */
  app.post("/api/v1/instances/import", async (req, reply) => {
    const data = await req.file();
    if (!data) throw new ValidationError("未上传文件");
    const tmp = path.join(c.config.dataDir, ".imports", `${crypto.randomUUID()}${path.extname(data.filename)}`);
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    await pipeline(data.file, fs.createWriteStream(tmp));
    try {
      const result = await c.imports.importFrom(tmp, data.filename, {});
      return ok(reply, result, 201);
    } finally {
      await fs.promises.rm(tmp, { force: true });
    }
  });
}
