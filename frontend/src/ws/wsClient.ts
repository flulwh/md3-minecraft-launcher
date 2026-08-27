import { API_BASE } from "../api/http";
import type { EventEnvelope, DownloadProgressData, MinecraftLogData, RepairProgressData } from "../api/types";
import { wsStore } from "../stores/wsStore";

export type WsEventHandler = (envelope: EventEnvelope) => void;

type ServerMessage = EventEnvelope & { type: string };

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;
const PING_INTERVAL_MS = 25000;

class WsClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<WsEventHandler>();
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private subscribedInstanceId: string | null = null;

  connect(): void {
    if (this.stopped || this.ws !== null) return;
    const url = API_BASE.replace(/^http/, "ws") + "/ws";
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;

    socket.onopen = () => {
      this.attempts = 0;
      wsStore.getState().setConnected(true);
      this.startPing();
      // Re-assert the subscription after a reconnect: the server resets per-socket state.
      if (this.subscribedInstanceId !== null) {
        this.send({ type: "subscribe", instanceId: this.subscribedInstanceId });
      }
    };
    socket.onmessage = (ev: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(ev.data) as ServerMessage;
        for (const handler of this.handlers) handler(msg);
      } catch {
        /* ignore malformed frame */
      }
    };
    socket.onclose = () => {
      this.cleanupSocket();
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      /* onclose follows */
    };
  }

  disconnect(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.subscribedInstanceId = null;
    this.ws?.close();
    this.cleanupSocket();
  }

  on(handler: WsEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Filter server events to a single instance. */
  subscribe(instanceId: string): void {
    this.subscribedInstanceId = instanceId;
    this.send({ type: "subscribe", instanceId });
  }

  /** Revert to receiving events for all instances. */
  unsubscribe(): void {
    this.subscribedInstanceId = null;
    this.send({ type: "unsubscribe" });
  }

  private send(payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping" }));
      }
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private cleanupSocket(): void {
    this.stopPing();
    this.ws = null;
    wsStore.getState().setConnected(false);
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== null) return;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.attempts) + Math.random() * 300;
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

export type { DownloadProgressData, MinecraftLogData, RepairProgressData };
export const wsClient = new WsClient();
