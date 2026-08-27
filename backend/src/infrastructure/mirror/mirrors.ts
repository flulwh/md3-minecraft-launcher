/**
 * Download source mirroring.
 *
 * Official (Global):
 *   https://launchermeta.mojang.com  / https://piston-meta.mojang.com  (manifest + version meta)
 *   https://piston-data.mojang.com   (client jars)
 *   https://libraries.minecraft.net  (libraries)
 *   https://resources.download.minecraft.net (assets)
 *
 * BMCLAPI (CN mirror, bangbang93.com):
 *   https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json
 *   https://bmclapi2.bangbang93.com/...            (meta & data rewrites)
 *   https://bmclapi2.bangbang93.com/maven/...      (libraries)
 *   https://bmclapi2.bangbang93.com/assets/...     (assets)
 */
export type MirrorMode = "auto" | "official" | "bmclapi";

export const BMCLAPI_BASE = "https://bmclapi2.bangbang93.com";

export const OFFICIAL_MANIFEST_URLS = [
  "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json",
  "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
];

export const BMCLAPI_MANIFEST_URLS = [
  `${BMCLAPI_BASE}/mc/game/version_manifest_v2.json`,
];

interface RewriteRule {
  pattern: RegExp;
  replacement: string;
}

const REWRITE_RULES: RewriteRule[] = [
  { pattern: /^https:\/\/piston-meta\.mojang\.com\//, replacement: `${BMCLAPI_BASE}/` },
  { pattern: /^https:\/\/launchermeta\.mojang\.com\//, replacement: `${BMCLAPI_BASE}/` },
  { pattern: /^https:\/\/launcher\.mojang\.com\//, replacement: `${BMCLAPI_BASE}/` },
  { pattern: /^https:\/\/piston-data\.mojang\.com\//, replacement: `${BMCLAPI_BASE}/` },
  { pattern: /^https:\/\/libraries\.minecraft\.net\//, replacement: `${BMCLAPI_BASE}/maven/` },
  {
    pattern: /^https:\/\/resources\.download\.minecraft\.net\//,
    replacement: `${BMCLAPI_BASE}/assets/`,
  },
];

/** Rewrites a canonical Mojang URL to its BMCLAPI equivalent when possible. */
export function toMirror(url: string): string | null {
  for (const rule of REWRITE_RULES) {
    if (rule.pattern.test(url)) {
      return url.replace(rule.pattern, rule.replacement);
    }
  }
  return null;
}

/**
 * Ordered candidate URLs for a download.
 *   auto    -> official first, mirror fallback
 *   official-> official only
 *   bmclapi -> mirror first, official fallback
 */
export function urlCandidates(url: string, mode: MirrorMode): string[] {
  const mirrored = toMirror(url);
  if (mode === "official") return [url];
  if (mode === "bmclapi") return mirrored !== null ? [mirrored, url] : [url];
  // auto
  return mirrored !== null ? [url, mirrored] : [url];
}

/** Manifest endpoints in preference order for the active mode. */
export function manifestSources(mode: MirrorMode): string[] {
  if (mode === "official") return OFFICIAL_MANIFEST_URLS;
  if (mode === "bmclapi") return BMCLAPI_MANIFEST_URLS;
  return [...OFFICIAL_MANIFEST_URLS, ...BMCLAPI_MANIFEST_URLS];
}
