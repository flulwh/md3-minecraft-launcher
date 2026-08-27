import { Logger } from "../../config/logger.js";
import { AppError } from "../../errors/index.js";
import { VersionMetadataStore } from "./version-metadata-store.js";
import {
  ArgumentsSection,
  ArgumentEntry,
  Library,
  ResolvedVersion,
  VersionJson,
} from "./types.js";

const MAX_INHERITANCE_DEPTH = 16;

export class InheritanceCycleError extends AppError {
  constructor(chain: string[]) {
    super(
      "LAUNCH_FAILED",
      `Version inheritance cycle detected: ${chain.join(" -> ")}`,
      409,
      { chain },
    );
  }
}

export class MissingParentError extends AppError {
  constructor(parentId: string) {
    super("VERSION_NOT_FOUND", `Inherited parent version '${parentId}' could not be loaded`, 404);
  }
}

function mavenName(lib: Library | undefined): string | null {
  return lib?.name ?? null;
}

/**
 * Merges raw version JSONs honouring Mojang's `inheritsFrom` semantics:
 *  - arrays (`arguments`, `libraries`) are concatenated (parent first);
 *  - scalars (`mainClass`, `jar`, `assetIndex`, `assets`, `downloads`,
 *    `javaVersion`, `logging`) are overridden by the child when present;
 *  - legacy `minecraftArguments` strings are concatenated;
 *  - duplicate library coordinates resolve to the child's entry.
 */
export class VersionResolver {
  constructor(
    private readonly store: VersionMetadataStore,
    private readonly logger: Logger,
  ) {}

  /** Whether a version profile is present in the local versions store. */
  hasLocal(id: string): boolean {
    return this.store.hasLocal(id);
  }

  async resolve(id: string): Promise<ResolvedVersion> {
    const chain: string[] = [];
    const stack = await this.collectChain(id, chain);
    const merged = this.mergeChain(stack);
    return this.toResolved(merged, chain);
  }

  private async collectChain(id: string, chain: string[]): Promise<VersionJson[]> {
    const jsons: VersionJson[] = [];
    let currentId: string | undefined = id;

    while (currentId !== undefined) {
      if (chain.includes(currentId)) {
        throw new InheritanceCycleError([...chain.slice(chain.indexOf(currentId)), currentId]);
      }
      if (chain.length >= MAX_INHERITANCE_DEPTH) {
        throw new AppError("LAUNCH_FAILED", `Version inheritance too deep (> ${MAX_INHERITANCE_DEPTH})`);
      }
      chain.push(currentId);
      const { json } = await this.store.getRaw(currentId);
      jsons.push(json); // collected child -> root
      currentId = json.inheritsFrom;
    }

    // index 0 is the requested version (child), last entry is the root parent
    return jsons;
  }

  private mergeChain(stack: VersionJson[]): VersionJson {
    if (stack.length === 0) throw new AppError("VERSION_NOT_FOUND", "Empty version chain");

    // `stack` is ordered child -> root (collectChain pushes the requested
    // version first, then walks up inheritsFrom). Merging must therefore start
    // from the root parent and overlay progressively more specific children,
    // so the child's mainClass/jar/assets win over the inherited parent's.
    let merged: VersionJson = { ...stack[stack.length - 1]! };
    for (let i = stack.length - 2; i >= 0; i--) {
      merged = this.overlayChild(merged, stack[i]!);
    }
    return merged;
  }

  /** child wins for scalars; arrays concat; libs dedupe preferring child. */
  private overlayChild(parent: VersionJson, child: VersionJson): VersionJson {
    const result: VersionJson = { ...child };

    const keepFromParentIfChildMissing = <K extends keyof VersionJson>(key: K): void => {
      if (result[key] === undefined && parent[key] !== undefined) {
        result[key] = parent[key];
      }
    };

    for (const key of [
      "type",
      "time",
      "releaseTime",
      "jar",
      "mainClass",
      "downloads",
      "assetIndex",
      "assets",
      "javaVersion",
      "complianceLevel",
      "minimumLauncherVersion",
    ] as const) {
      keepFromParentIfChildMissing(key);
    }

    // mainClass must exist somewhere in the chain
    if (!result.mainClass) keepFromParentIfChildMissing("mainClass");

    // logging: child section wins wholesale
    if (result.logging === undefined && parent.logging !== undefined) {
      result.logging = parent.logging;
    }

    // arguments: concatenate parent-then-child per section
    const pArgs: ArgumentsSection = parent.arguments ?? {};
    const cArgs: ArgumentsSection = child.arguments ?? {};
    if (pArgs.game || cArgs.game) {
      result.arguments = {
        ...(result.arguments ?? {}),
        game: [...(pArgs.game ?? []), ...(cArgs.game ?? [])],
        jvm: [...(pArgs.jvm ?? []), ...(cArgs.jvm ?? [])],
      };
    }

    // legacy minecraftArguments: each version carries the COMPLETE template
    // (e.g. vanilla 1.12 and its Forge child both spell out --username
    // --version --gameDir ... --versionType). Concatenating two full templates
    // duplicates every option and crashes legacy LaunchWrapper (joptsimple)
    // launches with MultipleArgumentsForOptionException for gameDir. The child
    // therefore replaces the parent wholesale; only fall back to the parent's
    // template when the child does not define one.
    if (result.minecraftArguments === undefined) {
      keepFromParentIfChildMissing("minecraftArguments");
    }

    // libraries: parent first, dedupe by coordinates preferring later (child)
    if (parent.libraries || child.libraries) {
      const all = [...(parent.libraries ?? []), ...(child.libraries ?? [])];
      result.libraries = this.dedupeLibraries(all);
    }

    delete result.inheritsFrom;
    return result;
  }

  private dedupeLibraries(all: Library[]): Library[] {
    const byCoord = new Map<string, number>();
    const out: Library[] = [];
    for (const lib of all) {
      const coord = mavenName(lib);
      if (coord === null) {
        out.push(lib);
        continue;
      }
      const existingIndex = byCoord.get(coord);
      if (existingIndex === undefined) {
        byCoord.set(coord, out.length);
        out.push(lib);
      } else {
        // later definitions override earlier ones (child over parent)
        out[existingIndex] = lib;
        this.logger.debug({ coord }, "library overridden by inheriting version");
      }
    }
    return out;
  }

  private toResolved(json: VersionJson, chain: string[]): ResolvedVersion {
    if (!json.mainClass) {
      throw new AppError("LAUNCH_FAILED", `Version '${json.id}' has no mainClass`);
    }

    const gameArgs: ArgumentEntry[] = json.arguments?.game ?? [];
    const jvmArgs: ArgumentEntry[] | undefined =
      json.arguments?.jvm !== undefined && json.arguments.jvm.length > 0
        ? json.arguments.jvm
        : undefined;

    return {
      id: json.id,
      type: json.type ?? "unknown",
      mainClass: json.mainClass,
      jarId: json.jar ?? json.id,
      ...(json.assets !== undefined ? { assets: json.assets } : {}),
      ...(json.assetIndex !== undefined ? { assetIndex: json.assetIndex } : {}),
      libraries: json.libraries ?? [],
      downloads: json.downloads ?? {},
      arguments: { game: gameArgs, ...(jvmArgs !== undefined ? { jvm: jvmArgs } : {}) },
      ...(json.minecraftArguments !== undefined
        ? { legacyMinecraftArguments: json.minecraftArguments }
        : {}),
      ...(json.javaVersion !== undefined ? { javaVersion: json.javaVersion } : {}),
      ...(json.logging?.client !== undefined ? { logging: json.logging.client } : {}),
      ...(json.complianceLevel !== undefined ? { complianceLevel: json.complianceLevel } : {}),
      inheritanceChain: chain,
    };
  }
}
