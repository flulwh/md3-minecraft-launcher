import { ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Logger } from "../../config/logger.js";
import { LaunchError } from "../../errors/index.js";
import { LaunchCommand } from "../launch/launch-command-builder.js";
import { EventBus, Events, MinecraftLogData } from "../../websocket/events.js";

export type MinecraftProcessStatus =
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "crashed";

export interface ManagedProcess {
  sessionId: string;
  instanceId: string;
  child: ChildProcess;
  pid: number | null;
  status: MinecraftProcessStatus;
  startedAtMs: number;
  endedAtMs: number | null;
  exitCode: number | null;
  crashReason: string | null;
}

interface StartOptions {
  sessionId: string;
  instanceId: string;
  command: LaunchCommand;
}

const LOG_LINE_RE = /^\[(\d{2}:\d{2}:\d{2})\]\s*\[[^/\]]+\/([A-Za-z]+)\](?:\s*\[[^\]]+\])?:?\s?(.*)$/;

/**
 * Spawns and supervises Minecraft processes.
 *   - argv-array spawning only (no shell), preventing command injection
 *   - realtime stdout/stderr streaming to the event bus
 *   - lifecycle state machine: starting -> running -> stopping -> stopped|crashed
 */
export class MinecraftProcessManager {
  private readonly sessions = new Map<string, ManagedProcess>();

  constructor(
    private readonly bus: EventBus,
    private readonly logger: Logger,
  ) {}

  async start(opts: StartOptions): Promise<ManagedProcess> {
    if (!fs.existsSync(opts.command.cwd)) {
      throw new LaunchError(`Working directory does not exist: ${opts.command.cwd}`);
    }
    if (!fs.existsSync(opts.command.javaPath)) {
      throw new LaunchError(`Java executable not found: ${opts.command.javaPath}`);
    }

    const logFile = path.join(opts.command.cwd, "launcher-output.log");
    const outStream = fs.createWriteStream(logFile, { flags: "a" });

    this.logger.info(
      { instanceId: opts.instanceId, sessionId: opts.sessionId },
      "spawning minecraft",
    );

    const child = spawn(opts.command.javaPath, opts.command.args, {
      cwd: opts.command.cwd,
      env: opts.command.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const proc: ManagedProcess = {
      sessionId: opts.sessionId,
      instanceId: opts.instanceId,
      child,
      pid: child.pid ?? null,
      status: "starting",
      startedAtMs: Date.now(),
      endedAtMs: null,
      exitCode: null,
      crashReason: null,
    };
    this.sessions.set(opts.sessionId, proc);

    this.bus.publish(
      Events.MINECRAFT_STARTING,
      { pid: proc.pid, sessionId: opts.sessionId },
      opts.instanceId,
    );

    const attachLog = (stream: NodeJS.ReadableStream, fallbackLevel: string): void => {
      const rl = readline.createInterface({ input: stream });
      rl.on("line", (line) => {
        const parsed = classifyLine(line, fallbackLevel);
        this.bus.publish<MinecraftLogData>(
          Events.MINECRAFT_LOG,
          { level: parsed.level, message: line },
          opts.instanceId,
        );
        outStream.write(`${line}\n`);
        void parsed;
      });
      rl.on("close", () => outStream.end());
    };

    if (child.stdout) attachLog(child.stdout, "INFO");
    if (child.stderr) attachLog(child.stderr, "ERROR");

    child.on("error", (err) => {
      this.logger.error({ err, sessionId: opts.sessionId }, "minecraft spawn error");
      proc.status = "crashed";
      proc.crashReason = err.message;
      proc.endedAtMs = Date.now();
      this.bus.publish(
        Events.MINECRAFT_CRASH,
        { reason: err.message, sessionId: opts.sessionId },
        opts.instanceId,
      );
    });

    child.on("close", (code, signal) => {
      proc.exitCode = code;
      proc.endedAtMs = Date.now();
      if (proc.status === "stopping") {
        proc.status = "stopped";
        this.bus.publish(
          Events.MINECRAFT_EXIT,
          { exitCode: code, signal, sessionId: opts.sessionId },
          opts.instanceId,
        );
      } else if ((code ?? 1) === 0) {
        proc.status = "stopped";
        this.bus.publish(
          Events.MINECRAFT_EXIT,
          { exitCode: code, signal, sessionId: opts.sessionId },
          opts.instanceId,
        );
      } else {
        proc.status = "crashed";
        proc.crashReason = `Non-zero exit code: ${code}${signal ? ` (${signal})` : ""}`;
        this.bus.publish(
          Events.MINECRAFT_CRASH,
          { reason: proc.crashReason, exitCode: code, sessionId: opts.sessionId },
          opts.instanceId,
        );
      }
      this.logger.info({ sessionId: opts.sessionId, code }, "minecraft exited");
    });

    // Retire the (now-exited) session after a short retention window so UI
    // consumers can still observe the terminal state without the map growing
    // unbounded for long-running processes.
    child.on("close", () => {
      const timer = setTimeout(() => {
        if (this.sessions.get(opts.sessionId) === proc) this.sessions.delete(opts.sessionId);
      }, 60_000);
      timer.unref?.();
    });

    // Consider the game "running" once it survives the immediate-failure window.
    setTimeout(() => {
      if (this.sessions.get(opts.sessionId) === proc && proc.status === "starting") {
        proc.status = "running";
        this.bus.publish(
          Events.MINECRAFT_STARTED,
          { pid: proc.pid, sessionId: opts.sessionId },
          opts.instanceId,
        );
      }
    }, 3000).unref?.();

    return proc;
  }

  get(sessionId: string): ManagedProcess | undefined {
    return this.sessions.get(sessionId);
  }

  list(): Array<Omit<ManagedProcess, "child">> {
    return [...this.sessions.values()].map(({ child, ...rest }) => {
      void child;
      return rest;
    });
  }

  /** Graceful stop: pipe `stop` to the server console, fall back to SIGTERM. */
  stop(sessionId: string, timeoutMs = 30_000): boolean {
    const proc = this.sessions.get(sessionId);
    if (!proc || !["starting", "running"].includes(proc.status)) return false;
    proc.status = "stopping";

    try {
      proc.child.stdin?.write("stop\n");
    } catch {
      /* console closed already */
    }

    const forceTimer = setTimeout(() => {
      if (proc.status === "stopping") this.kill(sessionId);
    }, timeoutMs);
    forceTimer.unref?.();

    return true;
  }

  kill(sessionId: string): boolean {
    const proc = this.sessions.get(sessionId);
    if (!proc || !["starting", "running", "stopping"].includes(proc.status)) return false;
    proc.status = "stopping";
    try {
      proc.child.kill("SIGKILL");
    } catch (err) {
      this.logger.warn({ err, sessionId }, "kill failed");
      return false;
    }
    return true;
  }

  isRunning(instanceId: string): boolean {
    for (const proc of this.sessions.values()) {
      if (proc.instanceId === instanceId && ["starting", "running"].includes(proc.status)) {
        return true;
      }
    }
    return false;
  }

  shutdownAll(): void {
    for (const id of [...this.sessions.keys()]) {
      try {
        this.kill(id);
      } catch {
        /* noop */
      }
    }
  }
}

function classifyLine(line: string, fallbackLevel: string): { level: string; message: string } {
  const match = LOG_LINE_RE.exec(line);
  if (match) {
    return { level: match[2]?.toUpperCase() ?? fallbackLevel, message: line };
  }
  return { level: fallbackLevel, message: line };
}
