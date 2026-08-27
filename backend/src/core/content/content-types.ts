/** Directory-scoped content kinds (each maps to a fixed folder under .minecraft). */
export type ContentKind = "mod" | "resourcepack" | "shaderpack";

export const CONTENT_DIRS: Record<ContentKind, string> = {
  mod: "mods",
  resourcepack: "resourcepacks",
  shaderpack: "shaderpacks",
};

/** Plural path segment -> ContentKind (used by the REST routes). */
export const KIND_BY_ROUTE: Record<string, ContentKind> = {
  mods: "mod",
  resourcepacks: "resourcepack",
  shaderpacks: "shaderpack",
};

export const ROUTE_BY_KIND: Record<ContentKind, string> = {
  mod: "mods",
  resourcepack: "resourcepacks",
  shaderpack: "shaderpacks",
};

/** Suffix appended to a mod file to disable it (e.g. `foo.jar.disabled`). */
export const MOD_DISABLED_SUFFIX = ".disabled";

export interface ContentEntry {
  fileName: string;
  size: number;
  mtimeMs: number;
  enabled: boolean;
}