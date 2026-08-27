import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import WebSocket from "ws";
import { AppContainer } from "./container.js";
import { AppError } from "./errors/index.js";
import type { ApiEnvelope, ApiErrorEnvelope } from "./api/respond.js";

import { healthRoutes } from "./api/routes/health.js";
import { authRoutes } from "./api/routes/auth.js";
import { versionRoutes } from "./api/routes/versions.js";
import { instanceRoutes } from "./api/routes/instances.js";
import { downloadRoutes } from "./api/routes/downloads.js";
import { javaRoutes } from "./api/routes/java.js";
import { loaderRoutes } from "./api/routes/loaders.js";
import { launchRoutes } from "./api/routes/launch.js";
import { settingsRoutes } from "./api/routes/settings.js";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
  }
}

export async function buildApp(c: AppContainer): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  void app.register(cors, {
    origin: true, // Electron renderer + dev servers
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
  });

  // MUST be awaited so its `onRoute` hook is active before `/ws` is registered,
  // otherwise `/ws` is treated as a plain HTTP route and the handler receives
  // (request, reply) instead of (socket, request).
  await app.register(websocket, {
    options: { maxPayload: 1024 * 1024 },
  });

  // ---- WebSocket gateway
  app.get("/ws", { websocket: true }, (socket: WebSocket, req) => {
    try {
      c.ws.register(socket);
    } catch (err) {
      c.logger.error({ err, url: req.url }, "websocket handler error");
      throw err;
    }
  });

  // ---- REST routes
  void healthRoutes(app, c);
  void authRoutes(app, c);
  void versionRoutes(app, c);
  void instanceRoutes(app, c);
  void downloadRoutes(app, c);
  void javaRoutes(app, c);
  void loaderRoutes(app, c);
  void launchRoutes(app, c);
  void settingsRoutes(app, c);

  // ---- structured error mapping (no stack traces in production)
  app.setErrorHandler((error: Error & Record<string, unknown>, req: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof AppError) {
      return reply.code(error.httpStatus).send({
        success: false,
        error: error.toJSON(),
      } satisfies ApiErrorEnvelope);
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Validation failed",
          details: { issues: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
        },
      } satisfies ApiErrorEnvelope);
    }

    // fastify's own validation / 404 handling
    const statusCode = typeof error.statusCode === "number" ? error.statusCode : 500;
    if (statusCode < 500) {
      return reply.code(statusCode).send({
        success: false,
        error: { code: "REQUEST_ERROR", message: error.message },
      } satisfies ApiErrorEnvelope);
    }

    c.logger.error({ err: error, url: req.url }, "unhandled request error");
    return reply.code(500).send({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: c.config.isProd ? "Internal server error" : error.message,
      },
    } satisfies ApiErrorEnvelope);
  });

  app.setNotFoundHandler((_req, reply) => {
    return reply.code(404).send({
      success: false,
      error: { code: "NOT_FOUND", message: "Route not found" },
    } satisfies ApiErrorEnvelope);
  });

  app.addHook("onClose", async () => {
    c.downloadManager.shutdown();
    c.processes.shutdownAll();
    await c.db.disconnect();
  });

  return app;
}
