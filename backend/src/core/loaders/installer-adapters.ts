import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { AppConfig } from "../../config/env.js";
import { Logger } from "../../config/logger.js";
import { HttpClient } from "../../infrastructure/http/http-client.js";
import { AppError, JavaRuntimeNotFoundError, NotFoundError } from "../../errors/index.js";
import { VersionMetadataStore } from "../version/version-metadata-store.js";
import { JavaRuntimeManager } from "../java/java-runtime-manager.js";
import { urlCandidates, MirrorMode } from "../../infrastructure/mirror/mirrors.js";
import type { SettingsService } from "../../services/settings-service.js";
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

/** Reads a zip entry into a buffer. */
async function readZipEntry(zipPath: string, entryName: string): Promise<Buffer | null> {
  // Use dynamic import for yazl (zip library) - optional dependency
  try {
    const { readFileSync } = await import("node:fs");
    const AdmZip = (await import("adm-zip")).default;
    const zip = new AdmZip(readFileSync(zipPath));
    const entry = zip.getEntry(entryName);
    if (!entry) return null;
    return entry.getData();
  } catch {
    return null;
  }
}

/**
 * Installer-based adapter for Forge-family loaders. The official installers
 * run headless via `--installClient` and materialize an inheriting version
 * profile into our shared versions store through a junctioned root.
 *
 * Fallback: when --installClient fails (e.g. network issues in China),
 * we parse the installer JAR as a zip, extract version.json, and save it
 * directly. Libraries are downloaded later by the repair pipeline.
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
    private readonly mirrorSettings?: SettingsService,
  ) {}

  private async getMirrorMode(): Promise<MirrorMode> {
    if (this.mirrorSettings) return this.mirrorSettings.getMirrorMode();
    return "auto";
  }

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

    // Try --installClient first, fall back to zip extraction if it fails
    try {
      return await this.installViaClient(installerDest, predicted, minecraftVersion);
    } catch (err) {
      this.logger.warn(
        { loader: this.id, err },
        "--installClient failed, falling back to installer zip extraction",
      );
      return await this.installViaZipExtraction(installerDest, predicted, minecraftVersion);
    }
  }

  /**
   * Primary installation method: run the installer with --installClient.
   * This is the standard approach that works when network access to Mojang
   * servers is available.
   */
  private async installViaClient(
    installerDest: string,
    predicted: string,
    _minecraftVersion: string,
  ): Promise<string> {
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

  /**
   * Fallback installation: parse the installer JAR as a zip file, extract
   * version.json, and save it directly. This avoids the installer's internal
   * downloads which may fail in restricted networks (e.g. China).
   *
   * The extracted version.json contains inheritsFrom and libraries that the
   * repair pipeline will download through our mirror system.
   */
  private async installViaZipExtraction(
    installerDest: string,
    predicted: string,
    minecraftVersion: string,
  ): Promise<string> {
    this.logger.info({ loader: this.id }, "extracting version.json from installer zip");

    // Try to read version.json from the installer zip
    const versionJsonBuffer = await readZipEntry(installerDest, "version.json");
    if (!versionJsonBuffer) {
      throw new AppError(
        "LOADER_INSTALL_FAILED",
        `Installer zip does not contain version.json. The installer may be corrupted or in an unexpected format.`,
      );
    }

    let versionJson: Record<string, unknown>;
    try {
      versionJson = JSON.parse(versionJsonBuffer.toString("utf8"));
    } catch {
      throw new AppError("LOADER_INSTALL_FAILED", "Installer version.json is not valid JSON");
    }

    // Determine the actual version ID from the extracted JSON
    const actualId = typeof versionJson.id === "string" ? versionJson.id : predicted;

    // Save the version JSON to our versions store
    const versionDir = path.join(this.config.versionsDir, actualId);
    fs.mkdirSync(versionDir, { recursive: true });
    const versionFile = path.join(versionDir, `${actualId}.json`);
    fs.writeFileSync(versionFile, JSON.stringify(versionJson, null, 2));

    // Also try to extract install_profile.json for processor information
    const installProfileBuffer = await readZipEntry(installerDest, "install_profile.json");
    if (installProfileBuffer) {
      try {
        const installProfile = JSON.parse(installProfileBuffer.toString("utf8"));
        // Save install_profile.json alongside version.json for potential processor execution
        fs.writeFileSync(
          path.join(versionDir, "install_profile.json"),
          JSON.stringify(installProfile, null, 2),
        );
        this.logger.info({ loader: this.id }, "saved install_profile.json");
      } catch {
        this.logger.warn({ loader: this.id }, "failed to parse install_profile.json (non-fatal)");
      }
    }

    // Try to extract data/client.lzma if present (needed for patching)
    const clientLzmaBuffer = await readZipEntry(installerDest, "data/client.lzma");
    if (clientLzmaBuffer) {
      fs.writeFileSync(path.join(versionDir, "client.lzma"), clientLzmaBuffer);
      this.logger.info({ loader: this.id }, "extracted data/client.lzma");
    }

    if (!(await this.validate(actualId))) {
      throw new AppError("LOADER_INSTALL_FAILED", `Failed to extract usable version from installer`);
    }

    this.logger.info({ loader: this.id, versionId: actualId }, "loader installed via zip extraction");
    return actualId;
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

    // Verify the version JSON is non-empty and contains required fields
    try {
      const content = fs.readFileSync(file, "utf8");
      if (content.length < 10) return false; // Suspiciously small
      const json = JSON.parse(content);
      if (!json.id || typeof json.id !== "string") return false;
      // Must have either inheritsFrom (mod loader) or downloads.client (vanilla)
      if (!json.inheritsFrom && !json.downloads?.client) return false;
      return true;
    } catch {
      return false;
    }
  }

  private async download(url: string, dest: string): Promise<void> {
    const mode = await this.getMirrorMode();
    const candidates = urlCandidates(url, mode);
    let lastError: unknown;
    for (const candidate of candidates) {
      try {
        await this.streamToFile(candidate, dest);
        return;
      } catch (err) {
        lastError = err;
        this.logger.debug({ url: candidate, err }, "installer mirror candidate failed");
      }
    }
    throw lastError instanceof Error ? lastError : new NotFoundError(`Installer at ${url}`);
  }

  private async streamToFile(url: string, dest: string): Promise<void> {
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
