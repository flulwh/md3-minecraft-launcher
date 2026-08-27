import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { DownloadTask, DownloadVerificationError } from "../src/core/download/download-task.js";
import type { HttpClient } from "../src/infrastructure/http/http-client.js";
import { makeConfig, makeLogger } from "./helpers.js";

const tmpDirs: string[] = [];

function fakeHttp(serve: Buffer, callbacks?: { onRange?: (start: number) => void }) {
  return {
    openStream: async (
      _url: string,
      opts?: { rangeStart?: number },
    ): Promise<{ status: number; acceptsRanges: boolean; stream: Readable; contentLength: number | null }> => {
      const start = opts?.rangeStart ?? 0;
      callbacks?.onRange?.(start);
      const remaining = serve.subarray(start);
      return {
        status: start > 0 ? 206 : 200,
        acceptsRanges: true,
        contentLength: remaining.length,
        stream: Readable.from(remaining),
      };
    },
  } as unknown as HttpClient;
}

function newTask(dest: string, request: Record<string, unknown>): DownloadTask {
  return new DownloadTask(crypto.randomUUID(), {
    urls: ["http://mirror.test/lib.jar"],
    dest,
    kind: "other",
    ...request,
  } as never, {
    http: fakeHttp(Buffer.alloc(0)),
    config: makeConfig({ dataDir: os.tmpdir() }),
    logger: makeLogger(),
  });
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const DATA = Buffer.from(crypto.randomBytes(80 * 1024));

describe("DownloadTask checksum verification", () => {
  it("accepts a matching sha512 and completes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dl-sha512-"));
    tmpDirs.push(root);
    const dest = path.join(root, "lib.jar");
    const expected = crypto.createHash("sha512").update(DATA).digest("hex");

    const task = new DownloadTask(
      crypto.randomUUID(),
      {
        urls: ["http://mirror.test/lib.jar"],
        dest,
        kind: "other",
        checksum: { algorithm: "sha512", value: expected },
        size: DATA.length,
      },
      {
        http: fakeHttp(DATA),
        config: makeConfig({ dataDir: root }),
        logger: makeLogger(),
      },
    );

    await task.run(new EventEmitter());
    expect(fs.readFileSync(dest)).toEqual(DATA);
  });

  it("rejects a checksum mismatch", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dl-bad-"));
    tmpDirs.push(root);
    const dest = path.join(root, "lib.jar");
    // Expected hash of *different* content, so the served DATA won't match.
    const other = Buffer.from("some other bytes, definitely not DATA");
    const expected = crypto.createHash("sha512").update(other).digest("hex");

    const task = new DownloadTask(
      crypto.randomUUID(),
      {
        urls: ["http://mirror.test/lib.jar"],
        dest,
        kind: "other",
        checksum: { algorithm: "sha512", value: expected },
        size: DATA.length,
      },
      {
        http: fakeHttp(DATA),
        config: makeConfig({ dataDir: root }),
        logger: makeLogger(),
      },
    );

    await expect(task.run(new EventEmitter())).rejects.toBeInstanceOf(DownloadVerificationError);
  });
});

describe("DownloadTask .part resume", () => {
  it("requests a Range from the existing partial file and completes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dl-resume-"));
    tmpDirs.push(root);
    const dest = path.join(root, "big.jar");

    // Seed the first ~40% as an existing .part (simulating an interrupted run).
    const cut = Math.floor(DATA.length * 0.4);
    fs.writeFileSync(`${dest}.part`, DATA.subarray(0, cut));

    const ranges: number[] = [];
    const task = new DownloadTask(
      crypto.randomUUID(),
      {
        urls: ["http://mirror.test/big.jar"],
        dest,
        kind: "other",
        checksum: { algorithm: "sha512", value: crypto.createHash("sha512").update(DATA).digest("hex") },
        size: DATA.length,
      },
      {
        http: fakeHttp(DATA, { onRange: (start) => ranges.push(start) }),
        config: makeConfig({ dataDir: root }),
        logger: makeLogger(),
      },
    );

    await task.run(new EventEmitter());
    expect(fs.readFileSync(dest)).toEqual(DATA);
    expect(ranges).toContain(cut); // resumed from the partial offset
  });
});