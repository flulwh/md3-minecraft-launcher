import { EventEmitter } from "node:events";

export interface EventEnvelope<T = unknown> {
  type: string;
  timestamp: number;
  instanceId?: string;
  data: T;
}

/** Well-known event types pushed over /ws */
export const Events = {
  DOWNLOAD_PROGRESS: "download.progress",
  DOWNLOAD_COMPLETED: "download.completed",
  DOWNLOAD_FAILED: "download.failed",
  REPAIR_PROGRESS: "repair.progress",
  MINECRAFT_STARTING: "minecraft.starting",
  MINECRAFT_STARTED: "minecraft.started",
  MINECRAFT_LOG: "minecraft.log",
  MINECRAFT_EXIT: "minecraft.exit",
  MINECRAFT_CRASH: "minecraft.crash",
  INSTANCE_UPDATED: "instance.updated",
  JAVA_SCAN_DONE: "java.scan.done",
} as const;

export interface MinecraftLogData {
  level: string;
  message: string;
}

export interface DownloadProgressData {
  taskId: string;
  kind: string;
  progressPct: number;
  receivedBytes: number;
  totalBytes: number | null;
  speedBps: number;
  etaSec: number | null;
}

/**
 * In-process pub/sub hub. Core modules publish; transports (WebSocket)
 * subscribe and fan out to clients.
 */
export class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  publish<T>(type: string, data: T, instanceId?: string): void {
    const envelope: EventEnvelope<T> = {
      type,
      timestamp: Date.now(),
      data,
      ...(instanceId !== undefined ? { instanceId } : {}),
    };
    this.emitter.emit("event", envelope);
  }

  subscribe(listener: (envelope: EventEnvelope) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }
}
