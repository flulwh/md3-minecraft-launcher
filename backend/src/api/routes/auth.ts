import type { FastifyInstance } from "fastify";
import { AppContainer } from "../../container.js";
import { ok } from "../respond.js";
import { yggdrasilLoginSchema, offlineLoginSchema, accountIdParamSchema } from "../schemas/index.js";
import { AuthError } from "../../errors/index.js";
import { parseBody } from "./health.js";

/** Account lifecycle: Yggdrasil (LittleSkin) + offline login, list & delete. */
export async function authRoutes(app: FastifyInstance, c: AppContainer): Promise<void> {
  /** POST /api/v1/auth/yggdrasil — log in via the Yggdrasil auth server (LittleSkin) */
  app.post("/api/v1/auth/yggdrasil", async (req, reply) => {
    const body = parseBody(yggdrasilLoginSchema, req.body);
    const account = await c.auth.loginYggdrasil(
      body.username,
      body.password,
      body.profileName,
    );
    return ok(reply, account, 201);
  });

  /** POST /api/v1/auth/offline — create an explicit offline account */
  app.post("/api/v1/auth/offline", async (req, reply) => {
    const body = parseBody(offlineLoginSchema, req.body);
    const account = await c.auth.createOfflineAccount(body.username);
    return ok(reply, account, 201);
  });

  /** GET /api/v1/accounts — list accounts */
  app.get("/api/v1/accounts", async (_req, reply) => {
    return ok(reply, await c.auth.listAccounts());
  });

  /** GET /api/v1/accounts/:id */
  app.get("/api/v1/accounts/:id", async (req, reply) => {
    const params = parseBody(accountIdParamSchema, req.params);
    return ok(reply, await c.auth.getPublicAccount(params.id));
  });

  /** DELETE /api/v1/accounts/:id — logout & remove stored credentials */
  app.delete("/api/v1/accounts/:id", async (req, reply) => {
    const params = parseBody(accountIdParamSchema, req.params);
    await c.auth.logout(params.id);
    return ok(reply, { loggedOut: true });
  });
}

export type { AuthError };