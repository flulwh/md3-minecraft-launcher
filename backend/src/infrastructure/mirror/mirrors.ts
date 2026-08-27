/**
 * Download source mirroring via BMCLAPI.
 *
 * Reference: https://bmclapidoc.bangbang93.com
 *
 * Mojang official hosts:
 *   launchermeta.mojang.com / launcher.mojang.com / piston-meta.mojang.com  (manifest + version meta)
 *   piston-data.mojang.com                                                 (client / server jars)
 *   libraries.minecraft.net                                                 (libraries)
 *   resources.download.minecraft.net                                        (assets)
 *
 * BMCLAPI path layout (from the docs):
 *   launchermeta / launcher / piston-meta  -> <base>/            (same path suffix)
 *   resources.download.minecraft.net       -> <base>/assets
 *   libraries.minecraft.net                -> <base>/maven
 *   files.minecraftforge.net/maven         -> <base>/maven
 *   maven.minecraftforge.net               -> <base>/maven
 *   maven.neoforged.net/releases           -> <base>/maven
 *   maven.fabricmc.net                     -> <base>/maven
 *   meta.fabricmc.net                      -> <base>/fabric-meta
 *   version/<id>/client                    -> downloadable client jar for the stable game body
 *
 * NOTE: piston-data.mojang.com is deliberately NOT rewritten to a generic
 * path — BMCLAPI exposes no `/v1/objects/<hash>` endpoint. The fast domestic
 * path for the game jar is `<base>/version/<id>/client` (see download-service).
 *
 * On top of `bmclapi2.bangbang93.com` several Chinese university mirrors
 * (校园网联合镜像站 https://mirrors.cernet.edu.cn/list/bmclapi) fully mirror
 * BMCLAPI under the `<base>/bmclapi` prefix, e.g. 齐鲁工业大学
 *   https://mirrors.qlu.edu.cn/bmclapi/maven/net/minecraftforge/forge/
 */
export type MirrorMode = "auto" | "official" | "bmclapi";

export const BMCLAPI_BASE = "https://bmclapi2.bangbang93.com";

/** BMCLAPI 高校镜像源（均以 /bmclapi 为前缀镜像了完整 BMCLAPI）。 */
export const BMCLAPI_MIRROR_BASES = [
  "https://mirrors.qlu.edu.cn/bmclapi",
  "https://mirror.nju.edu.cn/bmclapi",
  "https://mirrors.cqu.edu.cn/bmclapi",
  "https://mirrors.lzu.edu.cn/bmclapi",
  "https://mirrors.ustc.edu.cn/bmclapi",
];

export const OFFICIAL_MANIFEST_URLS = [
  "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
  "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json",
];

/** Canonical official prefix -> path suffix under the BMCLAPI mirror root. */
interface MirrorRule {
  prefix: string;
  target: string;
}

const MIRROR_RULES: MirrorRule[] = [
  { prefix: "https://launchermeta.mojang.com/", target: "/" },
  { prefix: "https://launcher.mojang.com/", target: "/" },
  { prefix: "https://piston-meta.mojang.com/", target: "/" },
  { prefix: "https://resources.download.minecraft.net/", target: "/assets/" },
  { prefix: "https://libraries.minecraft.net/", target: "/maven/" },
  { prefix: "https://maven.minecraftforge.net/", target: "/maven/" },
  { prefix: "https://files.minecraftforge.net/maven", target: "/maven/" },
  { prefix: "https://maven.neoforged.net/releases/", target: "/maven/" },
  { prefix: "https://maven.fabricmc.net/", target: "/maven/" },
  { prefix: "https://meta.fabricmc.net/", target: "/fabric-meta/" },
  { prefix: "https://maven.quiltmc.org/repository/release/", target: "/maven/" },
  { prefix: "https://meta.quiltmc.org/", target: "/quilt-meta/" },
];

/** Returns the BMCLAPI-relative path suffix for a canonical URL, or null. */
export function mirrorPath(url: string): string | null {
  for (const rule of MIRROR_RULES) {
    if (url.startsWith(rule.prefix)) {
      return `${rule.target}${url.slice(rule.prefix.length)}`;
    }
  }
  return null;
}

/** Maps a canonical URL to its equivalent on the primary BMCLAPI host. */
export function toMirror(url: string): string | null {
  const path = mirrorPath(url);
  return path === null ? null : `${BMCLAPI_BASE}${path}`;
}

/**
 * Ordered candidate mirrors for a canonical URL.
 *   auto    -> official first, mirrors fallback
 *   official-> official only
 *   bmclapi -> BMCLAPI + university mirrors first, official fallback
 */
export function urlCandidates(url: string, mode: MirrorMode): string[] {
  const path = mirrorPath(url);
  if (mode === "official" || path === null) return [url];

  const mirrored = [`${BMCLAPI_BASE}${path}`, ...BMCLAPI_MIRROR_BASES.map((b) => `${b}${path}`)];
  if (mode === "bmclapi") return [...mirrored, url];
  // auto
  return [url, ...mirrored];
}

/** Manifest endpoint: every BMCLAPI base serves the same canonical path. */
function manifestCandidates(base: string): string[] {
  return [`${base}/mc/game/version_manifest_v2.json`];
}

/** Manifest endpoints in preference order for the active mode. */
export function manifestSources(mode: MirrorMode): string[] {
  const mirrorHosts = [BMCLAPI_BASE, ...BMCLAPI_MIRROR_BASES];
  if (mode === "official") return OFFICIAL_MANIFEST_URLS;
  if (mode === "bmclapi") return mirrorHosts.flatMap(manifestCandidates);
  return [...OFFICIAL_MANIFEST_URLS, ...mirrorHosts.flatMap(manifestCandidates)];
}

/** Fast domestic candidates for a version's client jar via BMCLAPI. */
export function clientJarMirrorUrls(versionId: string): string[] {
  const safe = encodeURIComponent(versionId);
  return [BMCLAPI_BASE, ...BMCLAPI_MIRROR_BASES].map((b) => `${b}/version/${safe}/client`);
}