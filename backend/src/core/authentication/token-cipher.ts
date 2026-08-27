import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ALGO = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;

/**
 * AES-256-GCM envelope encryption for tokens at rest.
 * Key source (in order): LAUNCHER_SECRET env -> data/.secret keyfile (random).
 */
export class TokenCipher {
  private constructor(private readonly key: Buffer) {}

  static create(secretEnv: string | undefined, dataDir: string): TokenCipher {
    if (secretEnv && secretEnv.length >= 16) {
      // Use a per-device random salt (persisted like the .secret keyfile) rather
      // than a hard-coded constant: a fixed salt would make every deployment
      // sharing the same LAUNCHER_SECRET derive an identical key.
      const saltFile = path.join(dataDir, ".secret-salt");
      let salt: Buffer | null = null;
      try {
        const existing = fs.readFileSync(saltFile);
        if (existing.length >= 16) salt = existing;
      } catch {
        /* generate below */
      }
      if (!salt) {
        salt = crypto.randomBytes(16);
        fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(saltFile, salt, { mode: 0o600 });
        try {
          fs.chmodSync(saltFile, 0o600);
        } catch {
          /* windows: best effort */
        }
      }
      const key = crypto.scryptSync(secretEnv, salt, KEY_LENGTH);
      return new TokenCipher(key);
    }
    const keyFile = path.join(dataDir, ".secret");
    let raw: Buffer | null = null;
    try {
      const existing = fs.readFileSync(keyFile);
      if (existing.length === KEY_LENGTH) raw = existing;
    } catch {
      /* generate below */
    }
    if (!raw) {
      raw = crypto.randomBytes(KEY_LENGTH);
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(keyFile, raw, { mode: 0o600 });
      try {
        fs.chmodSync(keyFile, 0o600);
      } catch {
        /* windows: best effort */
      }
    }
    return new TokenCipher(raw);
  }

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGO, this.key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString("base64url")}.${enc.toString("base64url")}.${tag.toString("base64url")}`;
  }

  decrypt(payload: string): string {
    const parts = payload.split(".");
    if (parts.length !== 4 || parts[0] !== "v1") {
      throw new Error("Malformed ciphertext envelope");
    }
    const iv = Buffer.from(parts[1]!, "base64url");
    const data = Buffer.from(parts[2]!, "base64url");
    const tag = Buffer.from(parts[3]!, "base64url");
    const decipher = crypto.createDecipheriv(ALGO, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  }

  /** Safe check without decrypting: is this one of our envelopes? */
  static isEnvelope(value: string | null | undefined): boolean {
    return value !== null && value !== undefined && value.startsWith("v1.");
  }
}
