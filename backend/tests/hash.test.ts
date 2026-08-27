import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hashFile, sha1File } from "../src/utils/hash.js";

describe("hashFile", () => {
  it("computes sha512 of a file", async () => {
    const tmp = path.join(os.tmpdir(), `hash-test-${process.pid}.bin`);
    const data = crypto.randomBytes(64 * 1024);
    fs.writeFileSync(tmp, data);
    try {
      const expected = crypto.createHash("sha512").update(data).digest("hex");
      expect(await hashFile(tmp, "sha512")).toBe(expected);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });

  it("defaults to sha1", async () => {
    const tmp = path.join(os.tmpdir(), `hash-1-${process.pid}.bin`);
    const data = Buffer.from("hello checksum");
    fs.writeFileSync(tmp, data);
    try {
      const expected = crypto.createHash("sha1").update(data).digest("hex");
      expect(await hashFile(tmp)).toBe(expected);
      expect(await sha1File(tmp)).toBe(expected);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });
});