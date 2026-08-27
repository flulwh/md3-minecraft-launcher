import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { AppConfig } from "../../config/env.js";
import { Logger } from "../../config/logger.js";
import { HttpClient } from "../../infrastructure/http/http-client.js";
import { AppError, JavaRuntimeNotFoundError, NotFoundError } from "../../errors/index.js";
import { VersionMetadataStore } from "../version/version-metadata-store.js";
import { JavaRuntimeManager } from "../java/java-runtime-manager.js";
import {
  LoaderVersion,
  ModLoaderAdapter,
} from "./mod-loader-adapter.js";

const INSTALL_TIMEOUT_MS = 10 * 60_000;

function runInstaller(javaPath: string, installerJar: string, installDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      javaPath,
      ["-jar", installerJar, "--installClient", installDir],
      { timeout: INSTALL_TIMEOUT_MS, windowsHide: true },
      (err, _stdout, stderr) => {
        if (err) {
          reject(new AppError(
            "LOADER_INSTALL_FAILED",
            `Loader installer failed: ${err.message}${stderr ? ` — ${stderr.split("\n").slice(-3).join(" ")}` : ""}`,
          ));
        } else resolve();
      },
    );
  });
}

/** Reads a directory into a Set, tolerating a missing/unreadable dir. */
function safeReaddirSet(dir: string): Set<string> {
  try {
    return new Set(fs.readdirSync(dir));
  } catch {
    return new Set();
  }
}

/**
 * Recursively copies every file from srcDir into dstDir, keeping any file that
 * already exists in dstDir. Used to migrate a legacy (pre-junction) loader
 * library directory into the shared library store.
 */
function mergeDirInto(dstDir: string, srcDir: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(srcDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const src = path.join(srcDir, entry.name);
    const dst = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(dst, { recursive: true });
      mergeDirInto(dst, src);
    } else if (entry.isFile() && !fs.existsSync(dst)) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
  }
}

/**
 * Installer-based adapter for Forge-family loaders. The official installers
 * run headless via `--installClient` and materialize an inheriting version
 * profile into our shared versions store through a junctioned root.
 */
abstract class InstallerAdapter implements ModLoaderAdapter {
  abstract readonly id: "forge" | "neoforge";
  abstract readonly displayName: string;

  constructor(
    protected readonly config: AppConfig,
    protected readonly http: HttpClient,
    protected readonly store: VersionMetadataStore,
    protected readonly javaManager: JavaRuntimeManager,
    protected readonly logger: Logger,
  ) {}

  /** e.g. 1.20.1-47.2.0 */
  abstract installerUrl(minecraftVersion: string, loaderVersion: string): string;
  abstract versionId(minecraftVersion: string, loaderVersion: string): string;
  abstract versionIdCandidates(minecraftVersion: string, loaderVersion: string): string[];

  async getVersions(minecraftVersion: string): Promise<LoaderVersion[]> {
    const entries = await this.fetchVersionList(minecraftVersion);
    return entries.map((e) => ({ id: e.version, stable: true }));
  }

  protected abstract fetchVersionList(minecraftVersion: string): Promise<Array<{ version: string }>>;

  async install(minecraftVersion: string, loaderVersion: string): Promise<string> {
    const url = this.installerUrl(minecraftVersion, loaderVersion);
    const predicted = this.versionId(minecraftVersion, loaderVersion);

    // download installer
    const installerDest = path.join(this.config.downloadsDir, `${this.id}-installer-${predicted}.jar`);
    this.logger.info({ loader: this.id, url }, "downloading loader installer");
    await this.download(url, installerDest);

    // prepare junction root so the installer writes into the shared dirs
    const root = path.join(this.config.minecraftDir, `${this.id}-install-root`);
    const rootVersions = path.join(root, "versions");
    fs.mkdirSync(root, { recursive: true });
    if (!fs.existsSync(rootVersions)) {
      fs.symlinkSync(this.config.versionsDir, rootVersions, "junction");
    }

    // The installer also downloads all of its libraries into <root>/libraries.
    // Junction that to the shared library store so those jars (including
    // local-only artifacts like Forge's client jar) become part of the launch.
    const rootLibraries = path.join(root, "libraries");
    const rootLibStat = (() => {
      try {
        return fs.lstatSync(rootLibraries);
      } catch {
        return null;
      }
    })();
    if (rootLibStat === null) {
      fs.symlinkSync(this.config.librariesDir, rootLibraries, "junction");
    } else if (!rootLibStat.isSymbolicLink()) {
      // Legacy real directory from an earlier install: merge its files into the
      // shared store first, then swap it for a junction.
      mergeDirInto(this.config.librariesDir, rootLibraries);
      fs.rmSync(rootLibraries, { recursive: true, force: true });
      fs.symlinkSync(this.config.librariesDir, rootLibraries, "junction");
    }

    // Newer Forge installers refuse to run without an existing launcher profile
    // ("There is no minecraft launcher profile..."); seed an empty one so the
    // headless install proceeds. Harmless for other installer-based loaders.
    const profilesFile = path.join(root, "launcher_profiles.json");
    if (!fs.existsSync(profilesFile)) {
      fs.writeFileSync(
        profilesFile,
        JSON.stringify({ profiles: {}, selectedProfile: "", clientToken: "", authenticationDatabase: {} }, null, 2),
      );
    }

    // pick a suitable java for the installer
    let javaPath: string;
    try {
      const runtimes = await this.javaManager.detectAll();
      const chosen = this.javaManager.selectForRequirement(runtimes, Math.max(17, 0));
      javaPath = chosen.path;
    } catch (err) {
      if (err instanceof JavaRuntimeNotFoundError) throw err;
      throw new JavaRuntimeNotFoundError("A Java runtime is required to run the loader installer");
    }

    // snapshot versions dir so we can detect what the installer actually produced
    const before = safeReaddirSet(this.config.versionsDir);

    this.logger.info({ loader: this.id, versionId: predicted }, "running loader installer (headless)");
    await runInstaller(javaPath, installerDest, root);

    // Forge changed its version-id scheme for newer Minecraft versions
    // (forge-<mc>-<build> -> <mc>-forge-<build>), so discover the real one
    // instead of trusting the predicted id.
    const produced = this.discoverInstalledVersion(before);
    if (produced) {
      if (await this.validate(produced)) {
        this.logger.info({ loader: this.id, versionId: produced }, "loader installed");
        return produced;
      }
      throw new AppError("LOADER_INSTALL_FAILED", `Installer did not produce a usable '${produced}'`);
    }

    if (!(await this.validate(predicted))) {
      throw new AppError("LOADER_INSTALL_FAILED", `Installer did not produce '${predicted}'`);
    }
    return predicted;
  }

  /** Newly created versions dir entries that match this loader's id. */
  private discoverInstalledVersion(before: Set<string>): string | null {
    const after = safeReaddirSet(this.config.versionsDir);
    const candidates = [...after]
      .filter((v) => !before.has(v) && v.toLowerCase().includes(this.id.toLowerCase()))
      .sort((a, b) => b.length - a.length);
    return candidates[0] ?? null;
  }

  async uninstall(versionId: string): Promise<void> {
    const file = this.store.localVersionPath(versionId);
    if (!file) throw new AppError("LOADER_INSTALL_FAILED", `Invalid version id '${versionId}'`);
    const dir = path.dirname(file);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  async validate(versionId: string): Promise<boolean> {
    const file = this.store.localVersionPath(versionId);
    if (file === null || !fs.existsSync(file)) return false;
    const jar = file.replace(/\.json$/, ".jar");
    return fs.existsSync(jar);
  }

  private async download(url: string, dest: string): Promise<void> {
    const res = await this.http.openStream(url);
    if (res.status !== 200) {
      res.stream.destroy();
      throw new NotFoundError(`Installer at ${url}`);
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(dest);
      out.on("error", reject);
      res.stream.on("error", reject);
      out.on("finish", () => resolve());
      res.stream.pipe(out);
    });
  }
}

export class ForgeAdapter extends InstallerAdapter {
  readonly id = "forge" as const;
  readonly displayName = "Forge";

  installerUrl(minecraftVersion: string, loaderVersion: string): string {
    const full = loaderVersion.includes("-")
      ? loaderVersion
      : `${minecraftVersion}-${loaderVersion}`;
    return `https://maven.minecraftforge.net/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`;
  }

  versionId(minecraftVersion: string, loaderVersion: string): string {
    const full = loaderVersion.includes("-") ? loaderVersion : `${minecraftVersion}-${loaderVersion}`;
    return `forge-${full}`;
  }

  versionIdCandidates(minecraftVersion: string, loaderVersion: string): string[] {
    // Forge changed its version-id scheme for newer Minecraft versions
    // (1.21.3+): <mc>-forge-<build> ; legacy (<=1.21.1): forge-<mc>-<build>.
    const build = loaderVersion.includes("-") ? loaderVersion.slice(loaderVersion.indexOf("-") + 1) : loaderVersion;
    return [`${minecraftVersion}-forge-${build}`, `forge-${minecraftVersion}-${build}`];
  }

  protected async fetchVersionList(minecraftVersion: string): Promise<Array<{ version: string }>> {
    interface Promotions {
      promos?: Record<string, string>;
    }
    const data = await this.http.getJson<Promotions>(
      "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json",
    );
    const promos = data.promos ?? {};
    const out: Array<{ version: string }> = [];
    const suffixes = ["latest", "recommended"];
    for (const suffix of suffixes) {
      const v = promos[`${minecraftVersion}-${suffix}`];
      if (v && !out.some((o) => o.version === v)) out.push({ version: v });
    }
    return out;
  }
}

export class NeoForgeAdapter extends InstallerAdapter {
  readonly id = "neoforge" as const;
  readonly displayName = "NeoForge";

  installerUrl(_minecraftVersion: string, loaderVersion: string): string {
    return `https://maven.neoforged.net/releases/net/neoforged/neoforge/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`;
  }

  versionId(_minecraftVersion: string, loaderVersion: string): string {
    return `neoforge-${loaderVersion}`;
  }

  versionIdCandidates(_minecraftVersion: string, loaderVersion: string): string[] {
    return [`neoforge-${loaderVersion}`];
  }

  protected async fetchVersionList(minecraftVersion: string): Promise<Array<{ version: string }>> {
    const xml = await this.http.getJson<unknown>(
      `https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge?filter=${encodeURIComponent(minecraftVersion)}`,
    );
    if (xml && typeof xml === "object" && "versions" in xml) {
      const versions = (xml as { versions: unknown }).versions;
      if (Array.isArray(versions)) {
        return versions.filter((v): v is string => typeof v === "string").map((v) => ({ version: v }));
      }
    }
    return [];
  }
}
