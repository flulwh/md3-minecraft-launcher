# Minecraft Launcher Backend

A professional Minecraft launcher **runtime**: a Fastify API that resolves,
provisions and launches Minecraft instances (vanilla + mod loaders) the same
way the official launcher does, then streams live process events over
WebSockets.

> Status: backend runtime. No GUI — pair it with an Electron/renderer frontend
> (the CORS policy already allows browser/dev origins).

---

## Architecture

```
HTTP / WebSocket
   │
   ▼
Fastify API ──▶ Services (launch, download, instance, java, auth, version, repair)
   │                │
   │                ▼
   │             Core engine
   │             ├─ version resolver (inheritance-aware merge)
   │             ├─ library / native resolver (rule-evaluated)
   │             ├─ classpath builder
   │             ├─ JVM + game argument resolvers (variable substitution)
   │             ├─ launch command builder (spawn-safe, NUL-guarded)
   │             ├─ preflight checker
   │             └─ process manager (spawn, stream, crash detection)
   │                │
   │                ▼
   └────────▶ EventBus ──▶ WebSocketManager ──▶ connected clients
                    │
                    ▼
              Infrastructure (http, cache, database, mirror)

Dependency flow is explicit via a manual composition root (`src/container.ts`),
not a DI framework.
```

Launch does **not** build a shell string: it produces `{ javaPath, args[], cwd, env }`
meant for `child_process.spawn(javaPath, args)` — no shell injection surface.

---

## Requirements

- **Node.js ≥ 22** (set in `package.json` `engines`)
- A **Java runtime** to actually launch the game (Java 8 for ≤ 1.16.5, Java 17+
  for modern versions). The engine auto-detects Java on `PATH` and common install
  locations; you can also pin a path per instance.
- A SQLite file (created automatically) or any PostgreSQL URL via `DATABASE_URL`.

---

## Setup

```bash
corepack enable            # if you haven't already
pnpm install

# optional: copy and edit environment (defaults work out of the box)
cp .env.example .env       # see "Environment" below

pnpm db:generate           # generate Prisma client
pnpm dev                   # tsx watch src/server.ts
```

The server listens on `http://127.0.0.1:8787` (override with `HOST`/`PORT`).
Health check: `GET /api/v1/health`.

### Database

By default the launcher uses a local SQLite file under `DATA_DIR`
(`file:./data/launcher.db`). For Postgres set
`DATABASE_URL="postgresql://user:pass@host:5432/launcher"`. Run
`pnpm db:generate` after changing the provider.

---

## Scripts

| Script | Purpose |
| --- | --- |
| `pnpm dev` | Run with hot reload (`tsx watch`). |
| `pnpm build` | Compile TypeScript to `dist/`. |
| `pnpm start` | Run the compiled `dist/server.js`. |
| `pnpm typecheck` | `tsc --noEmit`. |
| `pnpm test` | Run unit tests (`vitest run`). |
| `pnpm smoke:launch` | Dry-run a vanilla 1.16.5 launch through the real services and assert the assembled command. |

---

## API Reference

All responses are wrapped: `{ success: true, data }` or
`{ success: false, error: { code, message, details? } }`.

### Health
- `GET /api/v1/health`

### Accounts / Auth
- `POST /api/v1/auth/yggdrasil` — LittleSkin / Yggdrasil login (`{ username, password, profileName? }`).
- `POST /api/v1/auth/offline` — create an offline account (`{ "username": "Steve" }`).
- `GET  /api/v1/accounts` — list accounts.
- `GET  /api/v1/accounts/:id` — get a public account.
- `DELETE /api/v1/accounts/:id` — remove account credentials.

### Instances
- `GET  /api/v1/instances`
- `POST /api/v1/instances` — create (`{ name, minecraftVersion, loader?, ... }`).
- `GET  /api/v1/instances/:id`
- `PATCH /api/v1/instances/:id` — partial update.
- `DELETE /api/v1/instances/:id`
- `POST /api/v1/instances/:id/repair` — re-provision client, libraries, natives, assets.

### Versions
- `GET /api/v1/versions` — list / search Mojang versions.
- `GET /api/v1/versions/latest`
- `GET /api/v1/versions/:version` — resolved metadata (inheritance merged).
- `GET /api/v1/versions/:version/libraries`

### Java
- `GET /api/v1/java/runtimes` — detected runtimes.
- `POST /api/v1/java/scan` — re-scan the system for Java.
- `GET /api/v1/java/recommendations?version=1.16.5` — recommended major version.

### Mod Loaders
- `GET /api/v1/loaders` — supported loaders (fabric, forge, neoforge, quilt).
- `GET /api/v1/loaders/:loader/versions`
- `POST /api/v1/instances/:id/loader` — attach a loader to an instance.
- `DELETE /api/v1/loaders/:loader/:versionId`

### Downloads
- `GET /api/v1/downloads` — active download tasks + manager stats.
- `POST /api/v1/downloads/:taskId/:action` — `pause` / `resume` / `cancel`.

### Launch
- `POST /api/v1/launch` — `{ instanceId, accountId, dryRun?, skipPreflight? }`.
  Spawns the process unless `dryRun` is set. Returns the assembled command,
  preflight result and (when real) a `sessionId` + `pid`.
- `POST /api/v1/launch/preview` — alias for `dryRun: true`.
- `GET /api/v1/launch/sessions` — live + recent sessions.
- `POST /api/v1/launch/sessions/:sessionId/stop` — graceful stop.
- `POST /api/v1/launch/sessions/:sessionId/kill` — force kill.

### Settings
- `GET /api/v1/settings`

---

## WebSocket (`/ws`)

Connect and (optionally) subscribe to a single instance's events:

```jsonc
{ "type": "subscribe", "instanceId": "cmt9w3pmp0001u618oa8wclkb" }
```

Events are JSON envelopes `{ type, instanceId?, sessionId?, timestamp, data }`.
Types include `hello`, `subscribed`, `launch_started`, `minecraft_log`,
`minecraft_exit`, `minecraft_crash`, `download_progress`, `instance_updated`, etc.
Send `{ "type": "ping" }` for a `pong`. Without a subscription you receive all
events; with one you receive only events for that instance.

```js
import WebSocket from "ws";
const ws = new WebSocket("ws://127.0.0.1:8787/ws");
ws.on("open", () => ws.send(JSON.stringify({ type: "subscribe", instanceId })));
```

---

## Launch flow

The engine runs the canonical chain (`src/services/launch-service.ts`):

1. **Validate account** (offline or Yggdrasil / LittleSkin).
2. **Validate instance** + prepare its isolated `.minecraft` directory.
3. **Resolve version** — merge `inheritsFrom` metadata (libraries, arguments,
   main class, asset index, java requirement) into a single resolved version.
4. **Resolve Java** — detect/select a runtime matching the required major version.
5. **Provision** (skipped for `dryRun`): download client jar, libraries, natives,
   assets via the mirror-aware download manager.
6. **Authenticate** — fetch a valid Minecraft token.
7. **Build classpath** — rule-approved library jars + client jar.
8. **Resolve JVM + game args** — rule-evaluated, `${variable}`-substituted, with
   launcher identity and log4j hardening always enforced.
9. **Assemble command** — `{ javaPath, args, cwd, env }` (NUL-guarded).
10. **Persist session + spawn** the process, streaming stdout/stderr and exit
    events over WebSocket.

---

## WebSocket bug note (historical)

`/ws` must be registered **after** `@fastify/websocket` is `await`-ed inside
`buildApp`. Registering the route before the plugin's `onRoute` hook is active
silently turns `/ws` into a plain HTTP route, so the handler receives
`(request, reply)` instead of `(socket, request)` and upgrades fail with `500`.
`buildApp` is `async` and `await app.register(websocket, …)` precisely to avoid
this.

---

## Testing

- `pnpm test` — unit tests for the pure core (argument resolvers, classpath,
  command builder, variable substitution, rule evaluator, library resolver).
- `pnpm smoke:launch` — end-to-end dry-run of a vanilla 1.16.5 launch that
  asserts the assembled command (Java path exists, classpath present, main
  class + player-name substitution correct).

Tests use Vitest; config is `vitest.config.ts`.
