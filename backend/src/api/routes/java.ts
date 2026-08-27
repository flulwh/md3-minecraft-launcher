import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppContainer } from "../../container.js";
import { ok } from "../respond.js";
import { parseBody } from "./health.js";
import type { JavaRuntime } from "../../core/java/java-runtime-manager.js";

const javaPathSchema = z.object({
  path: z.string().min(1).max(512),
});

export async function javaRoutes(app: FastifyInstance, c: AppContainer): Promise<void> {
  /** GET /api/v1/java/runtimes — detected runtimes (cached scan) */
  app.get("/api/v1/java/runtimes", async (_req, reply) => {
    return ok(reply, await c.java.list());
  });

  /** POST /api/v1/java/scan — force a fresh detection pass */
  app.post("/api/v1/java/scan", async (_req, reply) => {
    return ok(reply, await c.java.scan());
  });

  /** POST /api/v1/java/validate — probe a path with `java -version` and return info */
  app.post("/api/v1/java/validate", async (req, reply) => {
    const body = parseBody(javaPathSchema, req.body);
    const rt = await c.java.validatePath(body.path);
    return ok(reply, rt);
  });

  /** POST /api/v1/java/add — validate + persist an explicit Java path */
  app.post("/api/v1/java/add", async (req, reply) => {
    const body = parseBody(javaPathSchema, req.body);
    const rt = await c.java.addExplicit(body.path);
    return ok(reply, rt, 201);
  });

  /** DELETE /api/v1/java/remove — remove a manually-added Java path */
  app.delete("/api/v1/java/remove", async (req, reply) => {
    const body = parseBody(javaPathSchema, req.body);
    await c.java.removeExplicit(body.path);
    return ok(reply, { removed: true });
  });

  /** GET /api/v1/java/recommendations?version=1.20.1 */
  app.get("/api/v1/java/recommendations", async (req, reply) => {
    const q = req.query as { version?: string };
    const version = typeof q.version === "string" ? q.version : "";
    const resolved = await c.versions.resolve(version);
    const requiredMajor =
      resolved.javaVersion?.majorVersion ?? c.java.fallbackMajor(resolved.id);
    let runtimes: JavaRuntime[] = [];
    try {
      runtimes = await c.java.list();
    } catch {
      runtimes = [];
    }
    return ok(reply, {
      versionId: resolved.id,
      requiredMajorVersion: requiredMajor,
      declaredByMetadata: resolved.javaVersion !== undefined,
      compatible: runtimes.filter((r) => r.majorVersion >= requiredMajor),
    });
  });
}
