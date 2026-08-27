import pino from "pino";
import path from "node:path";
import fs from "node:fs";
import { AppConfig } from "../config/env.js";
import { levelNameFromRank, rootLogBuffer } from "../core/log/log-buffer.js";

export type Logger = pino.Logger;

let rootLogger: Logger | null = null;

/**
 * Renders a pino call's inputs into a single, human-readable string for the
 * in-memory log buffer. Handles the common call shapes used across the codebase:
 *   log({ ...fields }, "template with %s", value)
 *   log("plain string")
 *   log(error, "message")
 */
function formatArgs(inputArgs: unknown[]): string {
  let fields: Record<string, unknown> = {};
  const positional: unknown[] = [];

  for (const arg of inputArgs) {
    if (arg === null || arg === undefined) {
      positional.push(String(arg));
    } else if (arg instanceof Error) {
      positional.push(`${arg.name}: ${arg.message}`);
    } else if (typeof arg === "object") {
      fields = { ...fields, ...(arg as Record<string, unknown>) };
    } else {
      positional.push(arg);
    }
  }

  let template: string;
  const values: unknown[] = [];
  if (typeof fields.msg === "string") {
    template = fields.msg;
    delete fields.msg;
    values.push(...positional);
  } else if (positional.length > 0) {
    template = String(positional[0]);
    values.push(...positional.slice(1));
  } else {
    template = "";
  }

  let vi = 0;
  const resolved = template.replace(/%[sdjoOi%]/g, (token) => {
    if (token === "%%") return "%";
    const v = vi < values.length ? values[vi++] : "";
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  });

  const extra: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (k === "err" && v && typeof v === "object") {
      const err = v as { message?: string; stack?: string };
      extra.push(`err=${err.message ?? ""}`);
      const head = err.stack?.split("\n")[0];
      if (head) extra.push(head);
      continue;
    }
    let s = "";
    try {
      s = JSON.stringify(v) ?? "";
    } catch {
      s = String(v);
    }
    extra.push(`${k}=${s}`);
  }

  return extra.length ? `${resolved}  ${extra.join("  ")}` : resolved;
}

/** Pino hook: mirror every emitted log record into the in-memory history buffer. */
function logMethod(
  this: unknown,
  inputArgs: unknown[],
  method: pino.LogFn,
  level: number,
): void {
  try {
    const bindings = (this as { bindings?: () => Record<string, unknown> }).bindings?.() ?? {};
    rootLogBuffer.push(
      levelNameFromRank(level),
      formatArgs(inputArgs),
      typeof bindings.module === "string" ? bindings.module : undefined,
    );
  } catch {
    // The log view must never break normal logging.
  }
  return method.apply(this as never, inputArgs as never);
}

export function createLogger(config: AppConfig): Logger {
  if (rootLogger) return rootLogger;
  fs.mkdirSync(config.logsDir, { recursive: true });
  const targets: pino.TransportSingleOptions[] = [
    {
      target: config.isProd ? "pino/file" : "pino-pretty",
      options: config.isProd
        ? { destination: path.join(config.logsDir, "launcher.log"), mkdir: true }
        : { colorize: true, translateTime: "SYS:HH:MM:ss.l" },
    },
  ];
  if (config.isProd) {
    targets.push({
      target: "pino/file",
      options: { destination: 1, mkdir: false },
    });
  }
  rootLogger = pino({ level: config.env.LOG_LEVEL, hooks: { logMethod } }, pino.transport(targets.length === 1 ? targets[0]! : { targets: targets as pino.TransportMultiOptions["targets"] }));
  return rootLogger;
}

export function childLogger(base: Logger, module: string): Logger {
  return base.child({ module });
}
