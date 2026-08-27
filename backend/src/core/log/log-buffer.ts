/**
 * In-memory, bounded log history for the whole backend process.
 *
 * Every pino log record (regardless of child logger) is pushed here by the
 * `logMethod` hook wired in `config/logger.ts`, then surfaced through
 * `GET /api/v1/system/logs` so the Settings page can render a live, detailed
 * backend log view.
 */

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

export interface LogEntry {
  id: number;
  time: number;
  level: LogLevel;
  text: string;
  module?: string;
}

const LEVEL_RANK: Record<LogLevel, number> = {
  fatal: 60,
  error: 50,
  warn: 40,
  info: 30,
  debug: 20,
  trace: 10,
};

const RANK_TO_LEVEL: Record<number, LogLevel> = {
  60: "fatal",
  50: "error",
  40: "warn",
  30: "info",
  20: "debug",
  10: "trace",
};

/** Maps a pino numeric level to our level name (strictly typed cast). */
export function levelNameFromRank(rank: number): LogLevel {
  return RANK_TO_LEVEL[rank] ?? "info";
}

export class LogBuffer {
  private entries: LogEntry[] = [];
  private nextId = 1;

  constructor(readonly cap = 5000) {}

  push(level: LogLevel, text: string, module?: string): void {
    const entry: LogEntry = {
      id: this.nextId++,
      time: Date.now(),
      level,
      text,
      ...(module !== undefined && module !== "" ? { module } : {}),
    };
    this.entries.push(entry);
    if (this.entries.length > this.cap) {
      this.entries.splice(0, this.entries.length - this.cap);
    }
  }

  list(opts: { level?: LogLevel; limit?: number; afterId?: number } = {}): LogEntry[] {
    const minRank = opts.level !== undefined ? LEVEL_RANK[opts.level] : 0;
    let out = this.entries.filter((e) => LEVEL_RANK[e.level] >= minRank);
    const afterId = opts.afterId;
    if (afterId !== undefined) {
      out = out.filter((e) => e.id > afterId);
    }
    const limit = opts.limit ?? 1000;
    return limit > 0 ? out.slice(-limit) : out;
  }

  clear(): void {
    this.entries = [];
  }

  get size(): number {
    return this.entries.length;
  }
}

/** Singleton used by the logger hook and exposed on the app container. */
export const rootLogBuffer = new LogBuffer();