import { ValidationError } from "../errors/index.js";

/**
 * Safety bounds for extracting untrusted archives (instance import / restore).
 *
 * These guard against zip bombs and pathological archives: the biggest risk is
 * a single entry whose *uncompressed* size is enormous, because callers hand the
 * whole decompressed stream to `Buffer` in memory (`entry.getData()`). We check
 * `entry.header.size` (the central-directory uncompressed length) *before*
 * decompressing, and cap both aggregate and per-file totals.
 */
export const MAX_EXTRACT_ENTRIES = 200_000;
export const MAX_EXTRACT_BYTES = 8 * 1024 ** 3; // 8 GiB aggregate uncompressed
export const MAX_ENTRY_BYTES = 2 * 1024 ** 3; // 2 GiB per file

export interface ZipEntryLike {
  header?: { size?: number };
}

/**
 * Tracks extraction budget across a loop of entries. Call {@link reserve} for
 * every entry (directories included) before reading its payload; it throws a
 * {@link ValidationError} as soon as any bound is exceeded, so a malicious
 * archive is rejected up front instead of exhausting memory mid-loop.
 */
export class ExtractBudget {
  private usedBytes = 0;
  private entryCount = 0;

  constructor(
    readonly maxEntries = MAX_EXTRACT_ENTRIES,
    readonly maxBytes = MAX_EXTRACT_BYTES,
    readonly maxEntryBytes = MAX_ENTRY_BYTES,
  ) {}

  /**
   * Reserves budget for one entry. Returns its uncompressed size (0 for
   * entries with no header, e.g. directory records).
   */
  reserve(entry: ZipEntryLike): number {
    this.entryCount += 1;
    if (this.entryCount > this.maxEntries) {
      throw new ValidationError(`压缩包条目过多（超过 ${this.maxEntries} 个），已中止解压`);
    }

    const size = entry.header?.size ?? 0;
    if (size > this.maxEntryBytes) {
      throw new ValidationError(`压缩包内存在超大文件（解压后 ${size} 字节），已中止解压`);
    }

    this.usedBytes += size;
    if (this.usedBytes > this.maxBytes) {
      throw new ValidationError(`压缩包解压后总大小超过上限（${this.maxBytes} 字节），已中止解压`);
    }
    return size;
  }
}