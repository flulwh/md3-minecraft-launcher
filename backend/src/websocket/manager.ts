import type { FastifyReply } from "fastify";
import { WebSocket as WsSocket, RawData } from "ws";
import { Logger } from "../config/logger.js";
import { EventBus, EventEnvelope } from "./events.js";

interface ClientConnection {
  socket: WsSocket;
  subscribedInstanceId?: string | undefined;
}

/**
 * Fan-out hub for /ws. Every client receives all events unless it filters
 * by instanceId via `{"type":"subscribe","instanceId":"..."}`.
 */
export class WebSocketManager {
  private readonly clients = new Map<WsSocket, ClientConnection>();

  constructor(
    private readonly bus: EventBus,
    private readonly logger: Logger,
  ) {
    this.bus.subscribe((envelope) => this.broadcast(envelope));
  }

  register(socket: WsSocket): void {
    const conn: ClientConnection = { socket };
    this.clients.set(socket, conn);

    socket.addEventListener("message", (event) => {
      try {
        const msg: unknown = JSON.parse(event.data.toString());
        if (msg && typeof msg === "object" && "type" in msg) {
          const typed = msg as { type?: string; instanceId?: string };
          if (typed.type === "subscribe" && typeof typed.instanceId === "string") {
            conn.subscribedInstanceId = typed.instanceId;
            this.send(socket, {
              type: "subscribed",
              timestamp: Date.now(),
              data: { instanceId: typed.instanceId },
            });
          } else if (typed.type === "unsubscribe") {
            conn.subscribedInstanceId = undefined;
          } else if (typed.type === "ping") {
            this.send(socket, { type: "pong", timestamp: Date.now(), data: {} });
          }
        }
      } catch {
        this.send(socket, {
          type: "error",
          timestamp: Date.now(),
          data: { message: "Malformed message; expected JSON object" },
        });
      }
    });

    const closeHandler = (): void => {
      socket.removeEventListener("message", closeHandler);
      socket.removeEventListener("close", closeHandler);
      socket.removeEventListener("error", closeHandler);
      this.clients.delete(socket);
      this.logger.debug({ count: this.clients.size }, "ws client disconnected");
    };

    socket.addEventListener("close", closeHandler);
    socket.addEventListener("error", closeHandler);

    this.logger.debug({ count: this.clients.size }, "ws client connected");
    this.send(socket, {
      type: "hello",
      timestamp: Date.now(),
      data: { hint: 'send {"type":"subscribe","instanceId":"..."} to filter' },
    });
  }

  get clientCount(): number {
    return this.clients.size;
  }

  private broadcast(envelope: EventEnvelope): void {
    for (const conn of this.clients.values()) {
      const wantsInstance =
        conn.subscribedInstanceId === undefined ||
        envelope.instanceId === undefined ||
        conn.subscribedInstanceId === envelope.instanceId;
      if (wantsInstance) this.send(conn.socket, envelope);
    }
  }

  private send(socket: WsSocket, payload: EventEnvelope | { type: string; timestamp: number; data: unknown }): void {
    if (socket.readyState !== socket.OPEN) return;
    try {
      socket.send(JSON.stringify(payload));
    } catch (err) {
      this.logger.debug({ err }, "ws send failed");
    }
  }
}
