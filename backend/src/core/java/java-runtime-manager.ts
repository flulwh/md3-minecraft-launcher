import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { AppConfig } from "../../config/env.js";
import { Logger } from "../../config/logger.js";
import { JavaRuntimeNotFoundError } from "../../errors/index.js";
import {
  guessVendorFromPath,
  parseJavaArch,
  parseJavaVersionOutput,
} from "./java-version-parser.js";

export interface JavaRuntime {
  path: string;
  majorVersion: number;
  architecture: string;
  versionString?: string;
  vendor?: string;
  source: "system" | "managed" | "explicit";
}

const PROBE_TIMEOUT_MS = 15_000;

function execCapture(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { timeout: PROBE_TIMEOUT_MS, windowsHide: true, encoding: "utf8", maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        // `java -version` writes to stderr by design and still exits 0.
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "" });
        void err;
      },
    );
  });
}

/**
 * Discovers and probes Java runtimes:
 *   JAVA_HOME / JDK_HOME
 *   PATH lookup (where/which)
 *   well-known install locations per OS
 *   launcher-managed runtimes under <data>/runtimes/
 */
export class JavaRuntimeManager {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  async detectAll(): Promise<JavaRuntime[]> {
    const candidates = new Set<string>();

    this.addFromEnv(candidates);
    await this.addFromPathLookup(candidates);
    this.addWellKnownLocations(candidates);
    await this.addFromWinRegistry(candidates);
    this.addManagedRuntimes(candidates);

    const probes = [...candidates].map((c) => this.probeCandidate(c));
    const results = await Promise.allSettled(probes);
    const runtimes: JavaRuntime[] = [];
    for (const r of results) {
      if (r.status === "fulfilled" && r.value !== null) runtimes.push(r.value);
    }

    // dedupe by real path
    const byPath = new Map<string, JavaRuntime>();
    for (const rt of runtimes) byPath.set(rt.path.toLowerCase(), rt);
    const unique = [...byPath.values()].sort((a, b) => b.majorVersion - a.majorVersion);
    this.logger.debug({ count: unique.length }, "java runtimes detected");
    return unique;
  }

  /** Probes one explicit binary path (e.g. instance override). */
  async probeExplicitPath(executableOrHome: string): Promise<JavaRuntime> {
    const bin = await this.resolveExecutable(executableOrHome);
    const probed = await this.probe(bin);
    if (!probed) throw new JavaRuntimeNotFoundError(`'${executableOrHome}' is not a working Java runtime`);
    return { ...probed, source: "explicit" as const };
  }

  /**
   * Chooses the best runtime for a required major version.
   * Preference: exact match > closest higher version.
   */
  selectForRequirement(available: JavaRuntime[], requiredMajor: number | undefined): JavaRuntime {
    if (available.length === 0) {
      throw new JavaRuntimeNotFoundError("No Java runtime detected on this system");
    }
    if (requiredMajor === undefined) {
      const newest = available.reduce((best, rt) => (rt.majorVersion > best.majorVersion ? rt : best));
      return newest;
    }
    const exact = available.filter((r) => r.majorVersion === requiredMajor);
    if (exact.length > 0) {
      return exact.reduce((best, rt) => (rt.majorVersion > best.majorVersion ? rt : best));
    }
    const higher = available.filter((r) => r.majorVersion > requiredMajor).sort((a, b) => a.majorVersion - b.majorVersion);
    if (higher.length > 0) return higher[0]!;
    throw new JavaRuntimeNotFoundError(
      `No Java ${requiredMajor} available. Found: ${available.map((r) => r.majorVersion).join(", ")}`,
    );
  }

  /**
   * Compatibility fallback used when the version JSON has no javaVersion block.
   * Canonical Minecraft versions are "M.m.p" ("1.20.4" -> major 1, minor 20);
   * the leading major is always 1 for modern releases, so the minor segment
   * drives the Java requirement.
   */
  fallbackMajorFor(versionId: string): number {
    const m = /^(\d+)\.(\d+)/.exec(versionId);
    if (!m) return 8; // pre-1.x era ("a1.2.5", "b1.7.3", "c0.30")
    const major = Number.parseInt(m[1]!, 10);
    const minor = Number.parseInt(m[2]!, 10);

    // Mojang's official Java requirements (fallback only; the version JSON's
    // `javaVersion` block normally carries the authoritative value).
    if (major >= 2) return 21;
    if (minor >= 21) return 21; // 1.21+
    if (minor === 20) return 21; // 1.20.5+ needs 21; 21 also runs 1.20 - 1.20.4
    if (minor >= 18) return 17; // 1.18 - 1.19.x
    if (minor >= 17) return 16; // 1.17.x
    return 8; // 1.16 and earlier
  }

  private addFromEnv(candidates: Set<string>): void {
    for (const varName of ["JAVA_HOME", "JDK_HOME"]) {
      const home = process.env[varName];
      if (home && fs.existsSync(home)) {
        candidates.add(this.homeToBin(home));
      }
    }
  }

  private homeToBin(home: string): string {
    const binName = process.platform === "win32" ? "java.exe" : "java";
    return path.join(home, "bin", binName);
  }

  private async addFromPathLookup(candidates: Set<string>): Promise<void> {
    const cmd =
      process.platform === "win32" ? ["where.exe", "java"] : ["which", "-a", "java"];
    const result = await new Promise<string>((resolve) => {
      execFile(cmd[0]!, cmd.slice(1), { timeout: 5000, windowsHide: true }, (err, stdout) => {
        resolve(err ? "" : (stdout ?? ""));
      });
    });
    for (const line of result.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.length > 0 && fs.existsSync(trimmed)) candidates.add(trimmed);
    }
  }

  private addWellKnownLocations(candidates: Set<string>): void {
    const binName = process.platform === "win32" ? "java.exe" : "java";
    const roots: string[] = [];

    if (process.platform === "win32") {
      const pf = process.env["ProgramFiles"] ?? "C:\\Program Files";
      const pf86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
      const localAppData = process.env["LOCALAPPDATA"];
      roots.push(
        `${pf}\\Java`,
        `${pf86}\\Java`,
        `${pf}\\Eclipse Adoptium`,
        `${pf86}\\Eclipse Adoptium`,
        `${pf}\\Zulu`,
        `${pf}\\Microsoft`,
        `${pf}\\Amazon Corretto`,
        `${pf}\\BellSoft`,
        `${pf}\\Semeru`,
      );
      if (localAppData) roots.push(`${localAppData}\\Programs\\Eclipse Adoptium`);
    } else if (process.platform === "darwin") {
      roots.push("/Library/Java/JavaVirtualMachines");
    } else {
      roots.push("/usr/lib/jvm", "/opt/java", "/opt/jdk", "/usr/java");
    }

    for (const root of roots) {
      let entries: string[] = [];
      try {
        entries = fs.readdirSync(root);
      } catch {
        continue;
      }
      for (const dir of entries) {
        const base = path.join(root, dir);
        // macOS layout: <home>/Contents/Home/bin/java
        const macHome = path.join(base, "Contents", "Home", "bin", binName);
        const normalHome = path.join(base, "bin", binName);
        if (fs.existsSync(macHome)) candidates.add(macHome);
        else if (fs.existsSync(normalHome)) candidates.add(normalHome);
      }
    }
  }

  private addManagedRuntimes(candidates: Set<string>): void {
    try {
      const entries = fs.readdirSync(this.config.runtimesDir);
      for (const dir of entries) {
        const bin = path.join(this.config.runtimesDir, dir, "bin", process.platform === "win32" ? "java.exe" : "java");
        if (fs.existsSync(bin)) candidates.add(bin);
      }
    } catch {
      /* no managed runtimes yet */
    }
  }

  /**
   * On Windows, reads JAVA_HOME / JDK_HOME / PATH straight from the registry.
   *
   * Node's `process.env` is snapshotted when the process boots, so an
   * environment change made in System Properties *after* the backend started
   * is invisible to `addFromEnv`/`addFromPathLookup`. Querying the registry at
   * detection time picks those up on the next probe without a restart.
   */
  private async addFromWinRegistry(candidates: Set<string>): Promise<void> {
    if (process.platform !== "win32") return;
    const binName = "java.exe";
    let env: Record<string, string> = {};
    try {
      env = await readWindowsRegistryEnv();
    } catch {
      this.logger.debug({}, "failed to read java env from Windows registry");
      return;
    }
    for (const varName of ["JAVA_HOME", "JDK_HOME", "JAVA_HOME_x64", "JAVA_HOME_x86"]) {
      const home = env[varName];
      if (home && fs.existsSync(home)) {
        const bin = path.join(home, "bin", binName);
        if (fs.existsSync(bin)) candidates.add(bin);
      }
    }
    const pathVar = env["Path"] ?? env["PATH"] ?? "";
    for (const seg of pathVar.split(";")) {
      const trimmed = seg.trim();
      if (!trimmed) continue;
      const jp = path.join(trimmed, binName);
      if (fs.existsSync(jp)) candidates.add(jp);
    }
  }

  private async probeCandidate(candidate: string): Promise<JavaRuntime | null> {
    try {
      const bin = await this.resolveExecutable(candidate);
      return await this.probe(bin);
    } catch (err) {
      this.logger.debug({ err, candidate }, "java probe failed");
      return null;
    }
  }

  private async probe(bin: string): Promise<JavaRuntime | null> {
    const versionRes = await execCapture(bin, ["-version"]);
    const combined = `${versionRes.stdout}\n${versionRes.stderr}`;
    const parsedVersion = parseJavaVersionOutput(combined);
    if (!parsedVersion) return null;

    let architecture = process.arch === "ia32" ? "x86" : process.arch === "x64" ? "x86_64" : process.arch;
    try {
      const settingsRes = await execCapture(bin, ["-XshowSettings:properties", "-version"]);
      const arch = parseJavaArch(`${settingsRes.stdout}\n${settingsRes.stderr}`);
      if (arch) architecture = arch;
    } catch {
      /* keep default arch */
    }

    return {
      path: bin,
      majorVersion: parsedVersion.majorVersion,
      architecture,
      versionString: parsedVersion.versionString,
      ...(guessVendorFromPath(bin) !== null ? { vendor: guessVendorFromPath(bin)! } : {}),
      source: "system",
    };
  }

  private async resolveExecutable(input: string): Promise<string> {
    const binName = process.platform === "win32" ? "java.exe" : "java";

    // Direct executable?
    const directStat = await statOrNull(input);
    if (directStat?.isFile()) return path.resolve(input);

    // Home directory with bin/java?
    const inBin = path.join(input, "bin", binName);
    const inBinStat = await statOrNull(inBin);
    if (inBinStat?.isFile()) return path.resolve(inBin);

    // macOS Contents/Home?
    const macBin = path.join(input, "Contents", "Home", "bin", binName);
    const macStat = await statOrNull(macBin);
    if (macStat?.isFile()) return path.resolve(macBin);

    // On PATH? (bare "java")
    if (!input.includes(path.sep)) {
      return new Promise((resolve, reject) => {
        const cmd = process.platform === "win32" ? "where.exe" : "which";
        execFile(cmd, [input], { timeout: 5000, windowsHide: true }, (err, stdout) => {
          const first = (stdout ?? "").split(/\r?\n/)[0]?.trim();
          if (!err && first && fs.existsSync(first)) resolve(first);
          else reject(new Error(`Cannot resolve java executable from '${input}'`));
        });
      });
    }

    throw new Error(`Cannot resolve java executable from '${input}'`);
  }
}

async function statOrNull(p: string): Promise<fs.Stats | null> {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

const REG_ENV_KEYS = [
  "HKEY_CURRENT_USER\\Environment",
  "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
];

/**
 * Reads the *persisted* user/system environment variables (JAVA_HOME, Path, …)
 * from the Windows registry via `reg query`. Node's `process.env` only reflects
 * the environment at launch; this gives us the values the user last saved in
 * System Properties, merged with user scope taking precedence.
 */
async function readWindowsRegistryEnv(): Promise<Record<string, string>> {
  const merged: Record<string, string> = {};
  for (const keyPath of REG_ENV_KEYS) {
    const entries = await queryRegExports(keyPath);
    for (const [name, value] of entries) {
      merged[name] = merged[name] ?? value; // first (user) wins
    }
  }
  return merged;
}

async function queryRegExports(keyPath: string): Promise<Array<[string, string]>> {
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        "reg",
        ["query", keyPath, "/s"],
        { timeout: 8000, windowsHide: true, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
        (err, out) => {
          if (err) reject(err);
          else resolve(out ?? "");
        },
      );
    });
    if (!stdout) return [];
    const out: Array<[string, string]> = [];
    for (const line of stdout.split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s+REG_(?:EXPAND_)?SZ\s+(.+)$/.exec(line);
      if (m) out.push([m[1]!, m[2]!.trim()]);
    }
    return out;
  } catch {
    return [];
  }
}
