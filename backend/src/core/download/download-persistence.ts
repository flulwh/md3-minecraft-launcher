import { Database } from "../../infrastructure/database/database.js";
import { Logger } from "../../config/logger.js";
import { DownloadManager } from "./download-manager.js";
import { DownloadRequest, DownloadTaskSnapshot } from "./types.js";

/**
 * Persists download lifecycle into DownloadTaskRecord by subscribing to the
 * scheduler's events. Kept separate from DownloadManager so the scheduler stays
 * DB-agnostic; failures here are logged and never break a download.
 */
export function attachDownloadPersistence(
  manager: DownloadManager,
  db: Database,
  logger: Logger,
): void {
  const persist = (record: {
    id: string;
    kind: string;
    url: string;
    urlsJson?: string | null;
    targetPath: string;
    hashAlgorithm?: string | null;
    hashValue?: string | null;
    provider?: string | null;
    priority?: number | null;
    bytesTotal?: number | null;
    bytesDone: number;
    status: string;
    error?: string | null;
  }): void => {
    db.client.downloadTaskRecord
      .upsert({
        where: { id: record.id },
        create: {
          id: record.id,
          kind: record.kind,
          url: record.url,
          targetPath: record.targetPath,
          status: record.status,
          bytesTotal: record.bytesTotal ?? null,
          bytesDone: record.bytesDone,
          error: record.error ?? null,
          hashAlgorithm: record.hashAlgorithm ?? null,
          hashValue: record.hashValue ?? null,
          provider: record.provider ?? null,
          priority: record.priority ?? 0,
          urlsJson: record.urlsJson ?? null,
          retryCount: 0,
          finishedAt: terminal(record.status) ? new Date() : null,
        },
        update: {
          status: record.status,
          bytesTotal: record.bytesTotal ?? null,
          bytesDone: record.bytesDone,
          error: record.error ?? null,
          hashAlgorithm: record.hashAlgorithm ?? null,
          hashValue: record.hashValue ?? null,
          provider: record.provider ?? null,
          priority: record.priority ?? 0,
          urlsJson: record.urlsJson ?? null,
          finishedAt: terminal(record.status) ? new Date() : null,
        },
      })
      .catch((err) => {
        logger.error(
          { err, taskId: record.id, status: record.status },
          "failed to persist download task",
        );
      });
  };

  manager.events.on("task-added", (snap: DownloadTaskSnapshot) => {
    persist({
      id: snap.taskId,
      kind: snap.kind,
      url: snap.url ?? "",
      urlsJson: snap.urls ? JSON.stringify(snap.urls) : null,
      targetPath: snap.dest,
      hashAlgorithm: snap.hashAlgorithm ?? null,
      hashValue: snap.hashValue ?? null,
      provider: snap.provider ?? null,
      priority: snap.priority ?? 0,
      bytesTotal: snap.totalBytes,
      bytesDone: snap.receivedBytes,
      status: "pending",
    });
  });

  const terminalHandler = (snap: DownloadTaskSnapshot): void => {
    persist({
      id: snap.taskId,
      kind: snap.kind,
      url: snap.url ?? "",
      targetPath: snap.dest,
      hashAlgorithm: snap.hashAlgorithm ?? null,
      hashValue: snap.hashValue ?? null,
      provider: snap.provider ?? null,
      priority: snap.priority ?? 0,
      bytesTotal: snap.totalBytes ?? snap.receivedBytes,
      bytesDone: snap.receivedBytes,
      status: snap.status,
      error: snap.error ?? null,
    });
  };

  manager.events.on("task-completed", terminalHandler);
  manager.events.on("task-failed", terminalHandler);
  manager.events.on("task-cancelled", terminalHandler);
}

const RESUMEABLE = ["pending", "downloading"];

/**
 * Rebuilds the download queue from tasks that were interrupted by a shutdown/crash.
 * Recovers the request from the stored record (full mirror list, checksum, size)
 * and re-enqueues it; partial .part files let DownloadTask resume with Range.
 */
export async function resumeInterruptedDownloads(
  manager: DownloadManager,
  db: Database,
  logger: Logger,
): Promise<number> {
  const active = await db.client.downloadTaskRecord.findMany({
    where: { status: { in: RESUMEABLE } },
  });
  if (active.length === 0) return 0;

  let resumed = 0;
  for (const rec of active) {
    // Clear the stale record so the freshly re-enqueued task writes a new one.
    await db.client.downloadTaskRecord.delete({ where: { id: rec.id } }).catch(() => undefined);

    const urls = parseUrls(rec.urlsJson, rec.url);
    if (urls.length === 0) continue;

    const checksum =
      rec.hashAlgorithm && rec.hashValue
        ? { algorithm: rec.hashAlgorithm as "sha1" | "sha512", value: rec.hashValue }
        : undefined;

    const request: DownloadRequest = {
      urls,
      dest: rec.targetPath,
      kind: rec.kind as DownloadRequest["kind"],
      ...(rec.bytesTotal != null ? { size: rec.bytesTotal } : {}),
      ...(checksum ? { checksum } : {}),
      ...(rec.provider ? { provider: rec.provider } : {}),
      ...(rec.priority ? { priority: rec.priority } : {}),
    };

    try {
      manager.enqueue(request);
      resumed += 1;
    } catch (err) {
      logger.warn({ err, dest: rec.targetPath }, "failed to resume interrupted download");
    }
  }

  if (resumed > 0) {
    logger.info({ resumed, total: active.length }, "resuming interrupted downloads");
  }
  return resumed;
}

/** Parses the persisted mirror list, falling back to the single stored URL. */
function parseUrls(urlsJson: string | null, primary: string): string[] {
  if (urlsJson) {
    try {
      const parsed = JSON.parse(urlsJson) as unknown;
      if (Array.isArray(parsed) && parsed.every((u) => typeof u === "string")) {
        return (parsed as string[]).filter((u) => u.length > 0);
      }
    } catch {
      /* malformed; fall through to primary url */
    }
  }
  return primary.length > 0 ? [primary] : [];
}

function terminal(status: string): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}