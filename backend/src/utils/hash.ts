import crypto from "node:crypto";
import fs from "node:fs";
import { pipeline } from "node:stream/promises";

export function sha1Hex(data: crypto.BinaryLike): string {
  return crypto.createHash("sha1").update(data).digest("hex");
}

export async function sha1File(filePath: string): Promise<string> {
  return hashFile(filePath, "sha1");
}

/** Computes `algorithm` (e.g. sha1 | sha512) of a file. */
export async function hashFile(filePath: string, algorithm = "sha1"): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export async function hashAndCopyFile(src: string, dest: string): Promise<string> {
  await pipeline(fs.createReadStream(src), fs.createWriteStream(dest));
  return sha1File(dest);
}

export function verifySha1(actual: string | undefined, expected: string | undefined): boolean {
  if (!expected) return true;
  if (!actual) return false;
  return actual.toLowerCase() === expected.toLowerCase();
}
