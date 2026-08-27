import { ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Logger } from "../../config/logger.js";
import { LaunchError } from "../../errors/index.js";
import { LaunchCommand } from "../launch/launch-command-builder.js";
import { EventBus, Events, MinecraftLogData } from "../../websocket/events.js";
import { analyzeCrash, CrashDiagnosis, renderCrashReport } from "./crash-analyzer.js";

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
  /** Structured Process-Supervisor diagnosis, set when the process crashes. */
  diagnosis?: CrashDiagnosis;
  /** Absolute path of the auto-generated crash report (if any). */
  crashReportPath?: string;
}

interface StartOptions {
  sessionId: string;
  instanceId: string;
  command: LaunchCommand;
  /** Launch context the Process Supervisor uses to explain a crash. */
  meta?: { loader: string; minecraftVersion: string; javaMajor: number };
}

/** How many recent log lines are kept per session for crash analysis. */
const LOG_TAIL_LIMIT = 400;

const LOG_LINE_RE = /^\[(\d{2}:\d{2}:\d{2})\]\s*\[[^/\]]+\/([A-Za-z]+)\](?:\s*\[[^\]]+\])?:?\s?(.*)$/;

/**
 * Spawns and supervises Minecraft processes.
 *   - argv-array spawning only (no shell), preventing command injection
 *   - realtime stdout/stderr streaming to the event bus
 *   - lifecycle state machine: starting -> running -> stopping -> stopped|crashed
 */
export class MinecraftProcessManager {
  private readonly sessions = new Map<string, ManagedProcess>();
  private readonly tails = new Map<string, string[]>();

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
    this.tails.set(opts.sessionId, []);

    this.logger.info(
      { instanceId: opts.instanceId, sessionId: opts.sessionId },
      "spawning minecraft",
    );

    const child = spawn(opts.command.javaPath, opts.command.args, {
      cwd: opts.command.cwd,
      env: opts.command.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      // POSIX: separate process group so tree-kill can terminate descendants too.
      detached: process.platform !== "win32",
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
        const tail = this.tails.get(opts.sessionId);
        if (tail) {
          tail.push(line);
          if (tail.length > LOG_TAIL_LIMIT) tail.splice(0, tail.length - LOG_TAIL_LIMIT);
        }
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
        const diagnosed = this.diagnose(proc, opts, code, signal);
        proc.crashReason = diagnosed.diagnosis.headline.summary;
        this.bus.publish(
          Events.MINECRAFT_CRASH,
          {
            reason: proc.crashReason,
            exitCode: code,
            sessionId: opts.sessionId,
            diagnosis: diagnosed.diagnosis,
            crashReportPath: diagnosed.reportPath,
          },
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

  /**
   * Process-Supervisor analysis: turns the exit state into a diagnosis and,
   * where possible, writes a Markdown crash report into the game directory.
   */
  private diagnose(
    proc: ManagedProcess,
    opts: StartOptions,
    code: number | null,
    signal: string | null,
  ): { diagnosis: CrashDiagnosis; reportPath: string | null } {
    const meta = opts.meta ?? { loader: "vanilla", minecraftVersion: "unknown", javaMajor: 0 };
    const diagnosis = analyzeCrash({
      exitCode: code,
      signal,
      logTail: this.tails.get(opts.sessionId) ?? [],
      loader: meta.loader,
      minecraftVersion: meta.minecraftVersion,
      javaMajor: meta.javaMajor,
    });
    proc.diagnosis = diagnosis;

    let reportPath: string | null = null;
    try {
      const filename = `crash-report-${opts.sessionId.slice(0, 8)}.md`;
      reportPath = path.join(opts.command.cwd, filename);
      fs.writeFileSync(reportPath, renderCrashReport(
        {
          exitCode: code,
          signal,
          logTail: this.tails.get(opts.sessionId) ?? [],
          loader: meta.loader,
          minecraftVersion: meta.minecraftVersion,
          javaMajor: meta.javaMajor,
        },
        diagnosis,
      ));
    } catch (err) {
      this.logger.warn({ err, sessionId: opts.sessionId }, "failed to write crash report");
      reportPath = null;
    }

    if (proc.exitCode !== null || reportPath) {
      this.logger.warn(
        { sessionId: opts.sessionId, exitCode: code, category: diagnosis.headline.category },
        `[supervisor] crash classified: ${diagnosis.headline.summary}`,
      );
    }
    return { diagnosis, reportPath };
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
    const pid = proc.child.pid;
    try {
      const killed = this.killTree(pid);
      if (!killed) throw new Error("signal refused");
      return true;
    } catch (err) {
      this.logger.warn({ err, sessionId }, "kill failed");
      return false;
    }
  }

  /** Terminates the process and, where possible, its entire child process tree. */
  private killTree(pid: number | null | undefined): boolean {
    if (pid === null || pid === undefined) return false;
    if (process.platform === "win32") {
      // taskkill /T recurses into descendants; /F forces immediate termination.
      const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
      const res = spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      return res.status === 0;
    }
    try {
      // The child was spawned detached, so it leads a process group: a negative
      // pid signals the whole group, reaching native grandchildren as well.
      process.kill(-pid, "SIGKILL");
      return true;
    } catch {
      // Group kill unsupported (e.g. child never detached): fall back to the
      // direct child, which kill() verifies by pid before returning.
      return this.sessionsHasPid(pid);
    }
  }

  private sessionsHasPid(pid: number): boolean {
    for (const p of this.sessions.values()) {
      if (p.child.pid === pid) {
        try {
          p.child.kill("SIGKILL");
        } catch {
          /* noop */
        }
        return true;
      }
    }
    return false;
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
