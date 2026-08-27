import type { FastifyInstance } from "fastify";
import { AppContainer } from "../../container.js";
import { ok } from "../respond.js";
import type { JavaRuntime } from "../../core/java/java-runtime-manager.js";

export async function javaRoutes(app: FastifyInstance, c: AppContainer): Promise<void> {
  /** GET /api/v1/java/runtimes — detected runtimes (cached scan) */
  app.get("/api/v1/java/runtimes", async (_req, reply) => {
    return ok(reply, await c.java.list());
  });

  /** POST /api/v1/java/scan — force a fresh detection pass */
  app.post("/api/v1/java/scan", async (_req, reply) => {
    return ok(reply, await c.java.scan());
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
