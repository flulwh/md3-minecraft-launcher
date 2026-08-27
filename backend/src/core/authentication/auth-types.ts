import crypto from "node:crypto";

/** Deterministic offline-mode UUID (Bukkit-compatible v3 of "OfflinePlayer:<name>"). */
export function offlineUuidFor(name: string): string {
  const hash = crypto.createHash("md5").update(`OfflinePlayer:${name}`, "utf8").digest();
  hash[6] = (hash[6]! & 0x0f) | 0x30; // version 3
  hash[8] = (hash[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = hash.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

export interface MinecraftProfileInfo {
  id: string;
  name: string;
  skins?: unknown[];
  capes?: unknown[];
}

/** Normalize a UUID to the undashed, lowercased form expected by Mojang clients. */
export function normalizeUuid(uuid: string): string {
  return uuid.replace(/-/g, "").toLowerCase();
}