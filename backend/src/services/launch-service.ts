import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { AppConfig } from "../config/env.js";
import { Logger } from "../config/logger.js";
import { Database } from "../infrastructure/database/database.js";
import { EventBus, Events } from "../websocket/events.js";
import { VersionService } from "./version-service.js";
import { DownloadService } from "./download-service.js";
import { JavaService } from "./java-service.js";
import { InstanceService } from "./instance-service.js";
import { AuthenticationService } from "../core/authentication/authentication-service.js";
import { MinecraftProcessManager } from "../core/process/process-manager.js";
import { LaunchCommandBuilder, LaunchCommand, assertSafeLaunchJvmArg } from "../core/launch/launch-command-builder.js";
import { ClasspathBuilder } from "../core/classpath/classpath-builder.js";
import { GameArgumentResolver } from "../core/arguments/game-argument-resolver.js";
import { JvmArgumentResolver } from "../core/arguments/jvm-argument-resolver.js";
import { VariableMap } from "../core/arguments/variable-substitution.js";
import { PreflightChecker, PreflightResult, ReportBuilder } from "../core/preflight/preflight-checker.js";
import { LibraryResolver } from "../core/libraries/library-resolver.js";
import { LoaderRegistry } from "../core/loaders/loader-registry.js";
import { currentRuntime } from "../utils/runtime-env.js";
import { AppError, LaunchError } from "../errors/index.js";
import { applyJvmArgumentRules } from "../core/java/jvm-argument-rules.js";
import { checkJavaCompatibility, requiredMajorForVersion } from "../core/java/java-compatibility-engine.js";
import { buildLaunchProfile, LaunchProfile } from "../core/launch/launch-profile.js";

export interface LaunchOptions {
  instanceId: string;
  accountId: string;
  dryRun?: boolean;
  skipPreflight?: boolean;
}

/** Marker resource Forge/NeoForge's patched client jar must contain. */
const FORGE_PATCH_MARKER = ".forge_patched_minecraft";

/** Loader ids whose version profile carries a binary-patched client jar. */
const BINARY_PATCH_LOADERS = new Set(["forge", "neoforge"]);

export interface LaunchResult {
  sessionId: string | null;
  command: {
    javaPath: string;
    args: string[];
    cwd: string;
  };
  preflight: PreflightResult;
  pid?: number;
  /** Java Runtime Compatibility Engine verdict, surfaced to the UI. */
  compatibility?: {
    minecraftVersion: string;
    requiredJava: number;
    selectedJava: number;
    compatible: boolean;
    minJava: number;
    recommendedJava: number;
  };
  /** JVM arguments stripped by the compatibility engine (Java too old for them). */
  removedJvmArgs?: Array<{ argument: string; minJava: number; reason: string }>;
  /** Structured launch profile, surfaced for "查看启动命令" previews. */
  profile?: LaunchProfile;
}

/**
 * The launch engine. Executes the canonical chain:
 *
 *   Validate Account -> Validate Instance -> Resolve Version -> Resolve Java
 *   -> Resolve Libraries -> Resolve Natives -> Resolve Assets -> Classpath
 *   -> JVM Args -> Game Args -> Build Command -> Spawn Process
 */
export class LaunchService {
  private readonly gameArgs: GameArgumentResolver;
  private readonly jvmArgs: JvmArgumentResolver;
  private readonly preflightChecker: PreflightChecker;
  /** Per-instance launch mutex — prevents rapid double-click from spawning two
   *  concurrent launch attempts (race between `isRunning` check and process
   *  creation, #9). */
  private readonly launching = new Map<string, true>();

  constructor(
    private readonly config: AppConfig,
    private readonly db: Database,
    private readonly bus: EventBus,
    private readonly versions: VersionService,
    private readonly downloads: DownloadService,
    private readonly java: JavaService,
    private readonly instances: InstanceService,
    private readonly auth: AuthenticationService,
    private readonly processes: MinecraftProcessManager,
    private readonly logger: Logger,
    private readonly loaders: LoaderRegistry,
  ) {
    this.gameArgs = new GameArgumentResolver(logger);
    this.jvmArgs = new JvmArgumentResolver(logger);
    this.preflightChecker = new PreflightChecker(logger);
    this.wireSessionPersistence();
  }

  private newPreflight(): ReturnType<PreflightChecker["newReport"]> {
    return this.preflightChecker.newReport();
  }

  async launch(opts: LaunchOptions): Promise<LaunchResult> {
    // ---- Acquire launch mutex (race-free, same-instance only, #9)
    if (this.launching.has(opts.instanceId)) {
      throw new LaunchError("A launch is already in progress for this instance");
    }
    this.launching.set(opts.instanceId, true);
    const releaseLaunch = () => this.launching.delete(opts.instanceId);
    try {
    // ---- Validate Account
    const account = await this.auth.getPublicAccount(opts.accountId);
    const preflight = this.newPreflight();
    preflight.add(
      `Account ${account.username}`,
      true,
      undefined,
    );

    // ---- Validate Instance
    const instance = await this.instances.require(opts.instanceId);
    this.instances.prepareDirectories(instance.id);
    preflight.add(`Instance '${instance.name}'`, true);

    if (this.processes.isRunning(instance.id)) {
      throw new LaunchError("Instance already has a running process");
    }

    // ---- Resolve Version (inheritance aware)
    let resolvedVersionId = instance.minecraftVersion;
    if (instance.loader !== "vanilla" && instance.loaderVersion) {
      const adapter = this.loaders.get(instance.loader);
      if (adapter) {
        // Some loaders (Forge) changed their id scheme across MC versions, so
        // resolve against the candidate that is actually installed locally.
        const candidates = adapter.versionIdCandidates(instance.minecraftVersion, instance.loaderVersion);
        const installed = candidates.find((id) => this.versions.hasLocal(id));
        if (!installed) {
          throw new AppError(
            "VERSION_NOT_FOUND",
            `Mod loader ${instance.loader} ${instance.loaderVersion} is not installed. Please install it before launching.`,
            404,
          );
        }
        resolvedVersionId = installed;
      } else {
        resolvedVersionId = `${instance.loader}-${instance.loaderVersion}-${instance.minecraftVersion}`;
      }
    }
    const resolved = await this.versions.resolve(resolvedVersionId);
    preflight.add(
      `Minecraft ${instance.minecraftVersion}`,
      true,
      resolved.inheritanceChain.length > 1
        ? `inherits: ${resolved.inheritanceChain.join(" <- ")}`
        : undefined,
    );

    // ---- Resolve Java
    const requiredMajor =
      resolved.javaVersion?.majorVersion ?? this.java.fallbackMajor(resolved.id);
    const runtime = await this.java.resolveForLaunch({
      explicitPath: instance.javaPath,
      requiredMajor,
    });
    preflight.add(
      `Java ${runtime.majorVersion}`,
      true,
      `${runtime.path}${runtime.versionString ? ` (${runtime.versionString})` : ""}`,
    );

    // ---- Minecraft <-> Java compatibility (Java Runtime Compatibility Engine)
    const javaCompatibility = checkJavaCompatibility(instance.minecraftVersion, runtime.majorVersion);
    preflight.add(
      `Minecraft ↔ Java`,
      javaCompatibility.compatible,
      javaCompatibility.reason,
    );

    // memory sanity
    const totalMemMb = Math.floor(os.totalmem() / 1024 / 1024);
    if (instance.memoryMaxMb > totalMemMb) {
      preflight.add("Memory", false, `requested ${instance.memoryMaxMb}MB > system ${totalMemMb}MB`);
    }

    // ---- Provision: client + libraries + natives + assets
    const gameDir = this.instances.gameDirectory(instance.id);
    const nativesDir = this.instances.nativesDirectory(instance.id, resolved.id);

    // ---- Provision: client + libraries + natives + assets (skipped for previews)
    let provisioned: import("./download-service.js").ProvisionResult;
    if (opts.dryRun === true) {
      provisioned = this.previewOnly(resolved, nativesDir);
    } else {
      provisioned = await this.downloads.provision(resolved, {
        nativesDir,
        mirrorVersionId: instance.minecraftVersion,
      });
    }

    // ---- Loader installation verification (binary-patched client marker)
    if (BINARY_PATCH_LOADERS.has(instance.loader)) {
      await this.verifyLoaderInstallation(provisioned.classpathLibraries, preflight);
    }

    // ---- Classpath integrity: every rule-approved library + client must exist
    preflight.pathsExist(
      "Classpath entries",
      [...provisioned.classpathLibraries.map((l) => l.artifact.file), provisioned.clientJar],
    );

    // ---- Authentication token (after downloads so UI sees progress early)
    const mcToken = await this.auth.getValidMcToken(account.id);
    preflight.add("Authentication", true, `${mcToken.name}`);

    const report = preflight.finish();
    if (!report.success && !opts.skipPreflight) {
      throw new AppError("PREFLIGHT_FAILED", "Preflight checks failed", 409, {
        checks: report.checks.filter((c) => !c.ok),
      });
    }

    // ---- Build classpath
    const env = currentRuntime({
      has_custom_resolution: instance.width !== null && instance.height !== null,
      is_demo_user: false,
    });
    const classpathBuilder = new ClasspathBuilder(this.config.librariesDir);
    const cp = classpathBuilder.build(provisioned.classpathLibraries, provisioned.clientJar, env.os);

    this.logger.info({
      loader: instance.loader,
      loaderVersion: instance.loaderVersion,
      minecraft: instance.minecraftVersion,
      resolvedVersion: resolved.id,
      "launch.clientJar": provisioned.clientJar,
      "launch.classpathEntries": cp.entries.length,
      "launch.libraries": provisioned.classpathLibraries.length,
      "launch.natives": provisioned.nativeLibraries.length,
      mainClass: resolved.mainClass,
    }, "[Launch] forged launch summary");

    // ---- Variables
    const vars = this.buildVariables({
      playerName: mcToken.name,
      playerUuid: mcToken.uuid,
      accessToken: mcToken.token,
      userType: account.type === "offline" ? "legacy" : "mojang",
      versionId: resolved.id,
      versionType: resolved.type,
      instanceName: instance.name,
      gameDir,
      nativesDir,
      classpath: cp.classpath,
      assetsIndexName: resolved.assetIndex?.id ?? resolved.assets ?? "legacy",
      width: instance.width ?? 854,
      height: instance.height ?? 480,
      extraVars: parseRecord(instance.gameArgs),
    });

    // legacy virtual assets dir for old resource layout
    if (provisioned.assetIndex?.virtual === true || provisioned.assetIndex?.map_to_resources === true) {
      vars["game_assets"] = path.join(this.config.assetsDir, "virtual", resolved.assetIndex?.id ?? "legacy");
    }

    // ---- JVM args
    const extraJvmArgs = parseArray(instance.jvmArgs);
    // Memory is configured through the dedicated memoryMaxMb/memoryMinMb fields
    // (rendered into -Xmx/-Xms). A user-supplied -Xmx/-Xms/-Xss would silently
    // override or duplicate them — the JVM takes the last occurrence, making the
    // effective value unpredictable, so reject it instead (#5).
    const MEMORY_JVM_RE = /^-X(?:mx|ms|ss)[0-9.]+[kmgt]?$/i;
    const memoryConflict = extraJvmArgs.find((a) => MEMORY_JVM_RE.test(a));
    if (memoryConflict) {
      throw new LaunchError(
        `JVM 参数「${memoryConflict}」与「最大内存」设置冲突：请在“最大内存”滑块中设置内存，不要在额外 JVM 参数中重复填写`,
      );
    }
    // User-supplied JVM args must pass the allow-list (no agent loading, no
    // classpath/JAR override). Trusted launcher args (e.g. memory, the
    // authlib-injector -javaagent) are appended after validation.
    for (const userArg of extraJvmArgs) {
      try {
        assertSafeLaunchJvmArg(userArg);
      } catch (err) {
        throw new LaunchError(err instanceof Error ? err.message : "disallowed JVM argument");
      }
    }
    if (account.type === "yggdrasil") {
      // authlib-injector rewires the game's auth endpoints to the external
      // Yggdrasil server so the player name shows in the main menu and the
      // skin is fetched from the auth server (e.g. LittleSkin).
      const authlibJar = await this.downloads.ensureAuthlibInjector();
      extraJvmArgs.unshift(`-javaagent:${authlibJar}=${this.config.env.YGG_BASE_URL}`);
    }
    let jvm = this.jvmArgs.build(resolved.arguments.jvm, vars, env, {
      ...(instance.memoryMinMb !== null ? { minMemoryMb: instance.memoryMinMb } : {}),
      maxMemoryMb: instance.memoryMaxMb,
      extraJvmArgs,
    });

    // ---- JVM args (compatibility boundary)
    // Route every argument through the JVM Argument Compatibility Engine. It
    // strips version-specific flags (from the version profile OR user args) that
    // the selected Java runtime cannot parse, so the JVM never aborts with
    // "Unrecognized option" (e.g. --sun-misc-unsafe-memory-access JDK23+,
    // -XX:+UseCompactObjectHeaders JDK24+).
    const { args: jvmArgs, removed } = applyJvmArgumentRules(jvm, runtime.majorVersion);
    jvm = jvmArgs;
    for (const r of removed) {
      this.logger.warn(
        { ruleId: r.ruleId, argument: r.argument, minJava: r.minJava, java: runtime.majorVersion },
        `Removed incompatible JVM argument '${r.argument}' (needs Java ${r.minJava}+, using Java ${runtime.majorVersion}; ${r.reason})`,
      );
    }

    // ---- Game args
    const gameArgsList = [
      ...this.gameArgs.build(
        resolved.arguments.game,
        resolved.legacyMinecraftArguments,
        vars,
        env,
      ),
    ];
    if (instance.serverIp && instance.serverIp.length > 0) {
      gameArgsList.push("--server", instance.serverIp);
    }
    // Window size is injected by the legacyMinecraftArguments template as
    // `--width ${resolution_width} --height ${resolution_height}` (rendered from
    // buildVariables with a 854x480 default), so do NOT push it manually here —
    // duplicating it makes Forge's early-display fail to parse width as a single value.
    if (instance.fullscreen) {
      gameArgsList.push("--fullscreen");
    }

    // ---- Command
    const builder = new LaunchCommandBuilder();
    let command: LaunchCommand;
    try {
      command = builder.build({
        javaPath: runtime.path,
        jvmArgs: jvm,
        mainClass: resolved.mainClass,
        gameArgs: gameArgsList,
        cwd: gameDir,
      });
    } catch (err) {
      throw new LaunchError(err instanceof Error ? err.message : "command build failed");
    }

    const sessionId = crypto.randomUUID();

    // ---- Structured launch profile (preview / "view command" tooling)
    const profile: LaunchProfile = buildLaunchProfile({
      javaPath: command.javaPath,
      javaMajor: runtime.majorVersion,
      javaVendor: runtime.vendor ?? null,
      jvmArgs: jvm,
      gameArgs: gameArgsList,
      mainClass: resolved.mainClass,
      args: command.args,
      cwd: command.cwd,
      env: command.env,
      minecraftVersion: resolved.id,
      loaderType: instance.loader,
      loaderVersion: instance.loaderVersion,
      memoryMinMb: instance.memoryMinMb,
      memoryMaxMb: instance.memoryMaxMb,
      classpathEntryCount: cp.entries.length,
    });

    if (opts.dryRun === true) {
      return {
        sessionId: null,
        command: { javaPath: command.javaPath, args: command.args, cwd: command.cwd },
        preflight: report,
        compatibility: {
          minecraftVersion: instance.minecraftVersion,
          requiredJava: requiredMajor,
          selectedJava: runtime.majorVersion,
          compatible: javaCompatibility.compatible,
          minJava: javaCompatibility.minJava,
          recommendedJava: javaCompatibility.recommendedJava,
        },
        removedJvmArgs: removed.map((r) => ({ argument: r.argument, minJava: r.minJava, reason: r.reason })),
        profile,
      };
    }

    // ---- Persist session then spawn
    await this.db.client.launchSession.create({
      data: {
        id: sessionId,
        instanceId: instance.id,
        accountId: account.id,
        status: "starting",
        commandJson: JSON.stringify({ javaPath: command.javaPath, args: command.args }),
      },
    });

    // If spawn fails (e.g. missing cwd / java), mark the session as crashed
    // instead of leaving it permanently stuck in "starting".
    let proc: Awaited<ReturnType<MinecraftProcessManager["start"]>>;
    try {
      proc = await this.processes.start({
        sessionId,
        instanceId: instance.id,
        command,
        meta: {
          loader: instance.loader,
          minecraftVersion: instance.minecraftVersion,
          javaMajor: runtime.majorVersion,
        },
      });
    } catch (err) {
      try {
        await this.db.client.launchSession.update({
          where: { id: sessionId },
          data: {
            status: "crashed",
            endedAt: new Date(),
            crashReason: err instanceof Error ? err.message : "launch failed",
          },
        });
      } catch {
        /* best effort; surface the original spawn error below */
      }
      throw err;
    }
    await this.db.client.launchSession.update({
      where: { id: sessionId },
      data: { pid: proc.pid, status: "running" },
    });

    return {
      sessionId,
      ...(proc.pid !== null ? { pid: proc.pid } : {}),
      command: { javaPath: command.javaPath, args: command.args, cwd: command.cwd },
      preflight: report,
      compatibility: {
        minecraftVersion: instance.minecraftVersion,
        requiredJava: requiredMajor,
        selectedJava: runtime.majorVersion,
        compatible: javaCompatibility.compatible,
        minJava: javaCompatibility.minJava,
        recommendedJava: javaCompatibility.recommendedJava,
      },
      removedJvmArgs: removed.map((r) => ({ argument: r.argument, minJava: r.minJava, reason: r.reason })),
    };
    } finally {
      releaseLaunch();
    }
  }

  async stop(instanceId: string): Promise<boolean> {
    let stopped = false;
    for (const proc of this.processes.list()) {
      if (proc.instanceId === instanceId && ["starting", "running"].includes(proc.status)) {
        stopped = this.processes.stop(proc.sessionId) || stopped;
      }
    }
    return stopped;
  }

  listSessions() {
    return this.processes.list().map((p) => ({
      sessionId: p.sessionId,
      instanceId: p.instanceId,
      pid: p.pid,
      status: p.status,
      startedAtMs: p.startedAtMs,
      endedAtMs: p.endedAtMs,
      exitCode: p.exitCode,
      crashReason: p.crashReason,
      diagnosis: p.diagnosis,
      crashReportPath: p.crashReportPath,
    }));
  }

  async recentSessions(limit = 20) {
    const rows = await this.db.client.launchSession.findMany({
      orderBy: { startedAt: "desc" },
      take: Math.min(limit, 100),
    });
    return rows.map((r) => ({
      id: r.id,
      instanceId: r.instanceId,
      accountId: r.accountId,
      pid: r.pid,
      status: r.status,
      startedAt: r.startedAt.toISOString(),
      endedAt: r.endedAt?.toISOString() ?? null,
      exitCode: r.exitCode,
      crashReason: r.crashReason,
    }));
  }

  /**
   * Verifies a binary-patched loader's client jar is present AND actually
   * contains the `.forge_patched_minecraft` marker inside it. Files that only
   * "look" installed are rejected here rather than crashing at Forge boot.
   */
  private async verifyLoaderInstallation(
    libraries: import("../core/version/types.js").ResolvedLibrary[],
    preflight: ReportBuilder,
  ): Promise<void> {
    const localClients = libraries.filter(
      (l) => l.artifact.producedLocally === true && l.artifact.urls.length === 0,
    );
    const client =
      localClients.find(
        (l) => /^net\.(minecraftforge|neoforged)/.test(l.name) && /:client$/.test(l.name),
      ) ??
      localClients.find((l) => /(^|[\\/:])[^\\/:]*client[^\\/:]*\.jar$/i.test(l.artifact.file)) ??
      localClients[0];
    if (!client) {
      preflight.add(
        "Loader patched client",
        true,
        "no locally-produced client artifact in classpath",
      );
      return;
    }
    await preflight.jarMarker("Loader patched client", client.artifact.file, FORGE_PATCH_MARKER);
  }

  /**
   * Metadata-only provisioning for dry-run previews: resolves libraries via
   * rules without touching the network or filesystem state.
   */
  private previewOnly(
    resolved: import("../core/version/types.js").ResolvedVersion,
    nativesDir: string,
  ): import("./download-service.js").ProvisionResult {
    const resolver = new LibraryResolver(this.config);
    const resolution = resolver.resolve(resolved.libraries, currentRuntime());
    const safeJar = resolved.jarId.replace(/[^a-zA-Z0-9._-]/g, "_");
    return {
      clientJar: path.join(this.config.versionsDir, safeJar, `${safeJar}.jar`),
      classpathLibraries: resolution.classpath,
      nativeLibraries: resolution.natives,
      nativesDir,
      assetIndex: null,
      downloaded: 0,
      failed: 0,
      paused: 0,
    };
  }

  private buildVariables(input: {    playerName: string;
    playerUuid: string;
    accessToken: string;
    userType: string;
    versionId: string;
    versionType: string;
    instanceName: string;
    gameDir: string;
    nativesDir: string;
    classpath: string;
    assetsIndexName: string;
    width: number;
    height: number;
    extraVars: Record<string, string>;
  }): VariableMap {
    return {
      auth_player_name: input.playerName,
      auth_uuid: input.playerUuid,
      auth_access_token: input.accessToken,
      auth_session: `token:${input.accessToken}:${input.playerUuid}`,
      auth_xuid: "",
      clientid: "",
      user_type: input.userType,
      version_name: input.versionId,
      version_type: input.versionType,
      profile_name: input.instanceName,
      game_directory: input.gameDir,
      assets_root: this.config.assetsDir,
      assets_index_name: input.assetsIndexName,
      natives_directory: input.nativesDir,
      resolution_width: String(input.width),
      resolution_height: String(input.height),
      launcher_name: this.config.env.LAUNCHER_NAME,
      launcher_version: this.config.env.LAUNCHER_VERSION,
      classpath: input.classpath,
      library_directory: this.config.librariesDir,
      classpath_separator: process.platform === "win32" ? ";" : ":",
      user_properties: "{}",
      ...input.extraVars,
    };
  }

  private wireSessionPersistence(): void {
    this.bus.subscribe((envelope) => {
      this.handleSessionEvent(envelope.type, envelope.data as SessionEventData).catch((err) => {
        this.logger.debug({ err }, "session persistence skipped");
      });
    });
  }

  private async handleSessionEvent(type: string, data: SessionEventData): Promise<void> {
    const isTerminal = type === Events.MINECRAFT_EXIT || type === Events.MINECRAFT_CRASH;
    if (!isTerminal) return;
    if (!data || typeof data.sessionId !== "string") return;

    const updateData: {
      status: string;
      endedAt: Date;
      exitCode: number | null;
      crashReason?: string;
    } = {
      status: type === Events.MINECRAFT_CRASH ? "crashed" : "stopped",
      endedAt: new Date(),
      exitCode: typeof data.exitCode === "number" ? data.exitCode : null,
    };
    if (type === Events.MINECRAFT_CRASH && typeof data.reason === "string") {
      updateData.crashReason = data.reason;
    }

    try {
      await this.db.client.launchSession.update({
        where: { id: data.sessionId },
        data: updateData,
      });
    } catch {
      // session row may not exist (dry-run or race); nothing to persist
    }
  }
}

interface SessionEventData {
  sessionId?: unknown;
  exitCode?: unknown;
  reason?: unknown;
}

function parseArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function parseRecord(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (v === null || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === "string") out[k] = val;
    }
    return out;
  } catch {
    return {};
  }
}
