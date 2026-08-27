/**
 * Minecraft version JSON domain types.
 *
 * These are intentionally tolerant: the launcher must handle versions from
 * 2013 (legacy string arguments, natives classifiers) to the latest
 * (arguments arrays with rules). Optional fields reflect real-world variance.
 */

export type OsName = "windows" | "linux" | "osx";

export interface RuleOs {
  name?: OsName | (string & {});
  arch?: string;
  version?: string;
}

export interface RuleFeatures {
  [feature: string]: boolean;
}

export interface VersionRule {
  action: "allow" | "disallow";
  os?: RuleOs;
  features?: RuleFeatures;
}

export type RuleSet = VersionRule[];

export interface Artifact {
  path?: string;
  sha1: string;
  size: number;
  url: string;
}

export interface LibraryDownloads {
  artifact?: Artifact;
  classifiers?: Record<string, Artifact>;
}

export interface ExtractRules {
  exclude?: string[];
}

export interface Library {
  /** maven coordinates, e.g. com.mojang:brigadier:1.0.18 */
  name?: string;
  downloads?: LibraryDownloads;
  /** legacy library base URL when `downloads` is absent */
  url?: string;
  rules?: RuleSet;
  /** legacy native classifier selection */
  natives?: Partial<Record<OsName, string>>;
  extract?: ExtractRules;
  checksums?: string[];
}

export type GameArgumentValue = string;

export interface ObjectArgumentValue {
  rules?: RuleSet;
  value?: string | string[];
  values?: string | string[];
  ref?: string;
}

export type ArgumentEntry = GameArgumentValue | ObjectArgumentValue;

export function isObjectArgument(v: ArgumentEntry): v is ObjectArgumentValue {
  return typeof v === "object" && v !== null;
}

export interface ArgumentsSection {
  game?: ArgumentEntry[];
  jvm?: ArgumentEntry[];
}

export interface AssetIndexMeta {
  id: string;
  sha1: string;
  size: number;
  totalSize: number;
  url: string;
  minorVersion?: string;
}

export interface VersionDownloads {
  client?: Artifact;
  client_mappings?: Artifact;
  server?: Artifact;
  server_mappings?: Artifact;
  windows_server_exe?: Artifact;
  [key: string]: Artifact | undefined;
}

export interface JavaVersionRequirement {
  component: string;
  majorVersion: number;
}

export interface LoggingFileConfig {
  id: string;
  sha1: string;
  size: number;
  url: string;
}

export interface LoggingConfig {
  argument: string;
  file: LoggingFileConfig;
  type: string;
}

/** Raw (unmerged) version JSON as shipped by Mojang or mod loader metas. */
export interface VersionJson {
  id: string;
  type?: string;
  time?: string;
  releaseTime?: string;
  inheritsFrom?: string;
  jar?: string;
  mainClass?: string;
  arguments?: ArgumentsSection;
  /** legacy (< 1.13) space separated game arguments */
  minecraftArguments?: string;
  libraries?: Library[];
  downloads?: VersionDownloads;
  assetIndex?: AssetIndexMeta;
  assets?: string;
  javaVersion?: JavaVersionRequirement;
  logging?: { client?: LoggingConfig };
  complianceLevel?: number;
  minimumLauncherVersion?: number;
  [key: string]: unknown;
}

export interface ResolvedLibraryArtifact {
  /** absolute path of the artifact inside the libraries root */
  file: string;
  sha1?: string;
  size?: number;
  urls: string[];
}

export interface ResolvedLibrary {
  /** original maven coordinates or fallback name */
  name: string;
  artifact: ResolvedLibraryArtifact;
  kind: "class";
}

export interface ResolvedNativeLibrary {
  name: string;
  artifact: ResolvedLibraryArtifact;
  extractExclude: string[];
  targetDirName: string;
}

export interface ResolvedVersion {
  id: string;
  type: string;
  mainClass: string;
  jarId: string;
  assets?: string;
  assetIndex?: AssetIndexMeta;
  libraries: Library[];
  downloads: VersionDownloads;
  arguments: Required<Pick<ArgumentsSection, "game">> & Pick<ArgumentsSection, "jvm">;
  legacyMinecraftArguments?: string;
  javaVersion?: JavaVersionRequirement;
  logging?: LoggingConfig;
  complianceLevel?: number;
  inheritanceChain: string[];
}
