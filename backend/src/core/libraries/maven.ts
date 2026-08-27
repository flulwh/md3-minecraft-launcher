import { Library } from "../version/types.js";

export interface MavenCoordinates {
  group: string;
  artifact: string;
  version: string;
  classifier?: string;
  extension: string;
}

/**
 * Parses Maven coordinates such as:
 *   com.mojang:brigadier:1.0.18
 *   org.lwjgl.lwjgl:lwjgl-platform:2.9.4-nightly-20150209:natives-windows
 *   net.minecraftforge:forge:1.20.1-47.2.0:universal@jar
 */
export function parseMavenName(name: string): MavenCoordinates | null {
  const atSplit = name.split("@");
  const coordsPart = atSplit[0] ?? name;
  const extPart = atSplit.length > 1 ? atSplit[1] : undefined;
  const parts = coordsPart.split(":");
  if (parts.length < 3) return null;

  const group = parts[0];
  const artifact = parts[1];
  const version = parts[2];
  const classifier = parts.length > 3 ? parts[3] : undefined;
  if (!group || !artifact || !version) return null;

  return {
    group,
    artifact,
    version,
    ...(classifier !== undefined ? { classifier } : {}),
    extension: extPart ?? "jar",
  };
}

/** Builds the repo-relative path for a maven artifact. */
export function mavenArtifactPath(coords: MavenCoordinates): string {
  const groupPath = coords.group.split(".").join("/");
  const fileName = `${coords.artifact}-${coords.version}${
    coords.classifier ? `-${coords.classifier}` : ""
  }.${coords.extension}`;
  return `${groupPath}/${coords.artifact}/${coords.version}/${fileName}`;
}

export const DEFAULT_LIBRARIES_BASE = "https://libraries.minecraft.net/";

/**
 * Computes the candidate URLs for a legacy library (no `downloads` section):
 * custom base URL first (when given), Mojang's repository as fallback.
 */
export function legacyLibraryUrls(lib: Library, relativePath: string): string[] {
  const urls: string[] = [];
  if (lib.url) {
    const base = lib.url.endsWith("/") ? lib.url : `${lib.url}/`;
    urls.push(`${base}${relativePath}`);
  }
  urls.push(`${DEFAULT_LIBRARIES_BASE}${relativePath}`);
  return urls;
}
