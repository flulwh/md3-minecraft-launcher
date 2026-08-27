export interface LoaderVersion {
  id: string;
  stable: boolean;
}

/**
 * Adapter contract for mod loaders. Vanilla needs no adapter.
 * Implementations must be idempotent and offline-tolerant where possible.
 */
export interface ModLoaderAdapter {
  readonly id: "fabric" | "forge" | "neoforge" | "quilt";
  readonly displayName: string;

  getVersions(minecraftVersion: string): Promise<LoaderVersion[]>;

  /**
   * Canonical launcher version-id for a Minecraft version + loader version.
   * Every loader has its own id scheme (e.g. `fabric-loader-0.16.9-1.21.4`,
   * `forge-1.20.1-47.2.0`), so this is the single source of truth that
   * repair/launch use to resolve the installed profile.
   */
  versionId(minecraftVersion: string, loaderVersion: string): string;

  /**
   * All plausible version-ids for a Minecraft version + loader version, in
   * priority order. Some loaders changed their id scheme across Minecraft
   * versions (Forge switched from `forge-<mc>-<build>` to `<mc>-forge-<build>`),
   * so callers should pick the first candidate that exists locally.
   */
  versionIdCandidates(minecraftVersion: string, loaderVersion: string): string[];

  /**
   * Installs the loader for a Minecraft version.
   * Returns the launcher version-id that instances should reference.
   *
   * `onProgress` is invoked while the adapter downloads artifacts (installer
   * jar, vanilla client jar, maven jars) so the installation UI can render a
   * live progress bar instead of an indeterminate "0 B / 0 B".
   */
  install(
    minecraftVersion: string,
    loaderVersion: string,
    onProgress?: (downloadedBytes: number, totalBytes: number) => void,
  ): Promise<string>;

  uninstall(versionId: string): Promise<void>;

  validate(versionId: string): Promise<boolean>;
}

export class LoaderNotSupportedError extends Error {
  constructor(loaderId: string) {
    super(`Mod loader '${loaderId}' is not supported`);
    this.name = "LoaderNotSupportedError";
  }
}
