import pino from "pino";
import path from "node:path";
import fs from "node:fs";
import { AppConfig } from "../config/env.js";

export type Logger = pino.Logger;

let rootLogger: Logger | null = null;

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
  rootLogger = pino({ level: config.env.LOG_LEVEL }, pino.transport(targets.length === 1 ? targets[0]! : { targets: targets as pino.TransportMultiOptions["targets"] }));
  return rootLogger;
}

export function childLogger(base: Logger, module: string): Logger {
  return base.child({ module });
}
