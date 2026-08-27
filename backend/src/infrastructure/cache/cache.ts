import fs from "node:fs";
import path from "node:path";
import { AppConfig } from "../../config/env.js";
import { HttpClient } from "../http/http-client.js";

interface MemoryEntry<T> {
  value: T;
  expiresAt: number;
}

export class MemoryCache {
  private readonly store = new Map<string, MemoryEntry<unknown>>();

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

/**
 * Disk-backed JSON cache used to keep the launcher usable while offline.
 */
export class DiskCache {
  constructor(private readonly dir: string) {}

  private fileFor(key: string): string {
    const safe = key.replace(/[^a-zA-Z0-9._-]/g, "_");
    return path.join(this.dir, `${safe}.json`);
  }

  get<T>(key: string): T | undefined {
    try {
      const file = this.fileFor(key);
      if (!fs.existsSync(file)) return undefined;
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { storedAt: number; data: T };
      return raw.data;
    } catch {
      return undefined;
    }
  }

  set<T>(key: string, data: T): void {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(this.fileFor(key), JSON.stringify({ storedAt: Date.now(), data }));
    } catch {
      // disk cache is best-effort
    }
  }
}

export class CachedFetcher {
  private readonly memory = new MemoryCache();

  constructor(
    private readonly http: HttpClient,
    private readonly disk: DiskCache,
    private readonly memoryTtlMs = 10 * 60_000,
  ) {}

  async getJsonWithCache<T>(
    url: string,
    key: string,
    opts?: { memoryTtlMs?: number; validate?: (data: T) => boolean },
  ): Promise<{ data: T; source: "memory" | "disk" | "network" }> {
    const mem = this.memory.get<T>(key);
    if (mem !== undefined) return { data: mem, source: "memory" };

    try {
      const data = await this.http.getJson<T>(url);
      if (!opts?.validate || opts.validate(data)) {
        this.memory.set(key, data, opts?.memoryTtlMs ?? this.memoryTtlMs);
        this.disk.set(key, data);
        return { data, source: "network" };
      }
      throw new Error("network payload failed validation");
    } catch {
      const stale = this.disk.get<T>(key);
      if (stale !== undefined) return { data: stale, source: "disk" };
      throw new Error(
        `Failed to fetch '${key}' and no cached copy available (offline?)`,
      );
    }
  }

  invalidateMemory(): void {
    this.memory.clear();
  }

  /** Reads a key directly from the disk cache without hitting the network. */
  getFromDisk<T>(key: string): T | undefined {
    return this.disk.get<T>(key);
  }

  /** Persists a value to the disk cache under the given key (best-effort). */
  writeDisk<T>(key: string, data: T): void {
    this.disk.set(key, data);
  }
}

export function createCachedFetcher(http: HttpClient, config: AppConfig): CachedFetcher {
  return new CachedFetcher(http, new DiskCache(config.cacheDir));
}
