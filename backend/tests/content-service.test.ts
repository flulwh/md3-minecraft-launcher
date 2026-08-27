import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { ContentManager } from "../src/core/content/content-service.js";
import { EventBus } from "../src/websocket/events.js";
import type { Database } from "../src/infrastructure/database/database.js";
import type { InstanceService } from "../src/services/instance-service.js";
import { makeConfig, makeLogger } from "./helpers.js";

const tmpRoots: string[] = [];

function newHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "content-test-"));
  tmpRoots.push(root);
  const instanceId = "inst-1";
  const gameDir = path.join(root, instanceId, ".minecraft");
  const modsDir = path.join(gameDir, "mods");
  const packsDir = path.join(gameDir, "resourcepacks");
  fs.mkdirSync(modsDir, { recursive: true });
  fs.mkdirSync(packsDir, { recursive: true });

  // In-memory stand-in for the ContentOverride table (override-based kinds only).
  const overrides: Array<{ id: string; instanceId: string; kind: string; fileName: string; worldName: string; enabled: boolean }> = [];
  const db = {
    client: {
      contentOverride: {
        findMany: async () => overrides,
        findFirst: async (args: unknown) => {
          const a = (args as { where: { instanceId: string; kind: string; fileName: string; worldName: string } }).where;
          return (
            overrides.find(
              (o) =>
                o.instanceId === a.instanceId &&
                o.kind === a.kind &&
                o.fileName === a.fileName &&
                o.worldName === a.worldName,
            ) ?? null
          );
        },
        update: async (args: unknown) => {
          const a = args as { where: { id: string }; data: { enabled: boolean } };
          const o = overrides.find((o) => o.id === a.where.id)!;
          o.enabled = a.data.enabled;
          return o;
        },
        create: async (args: unknown) => {
          const a = args as { data: { instanceId: string; kind: string; fileName: string; worldName: string; enabled: boolean } };
          const rec = { id: `ov-${overrides.length}`, ...a.data };
          overrides.push(rec);
          return rec;
        },
      },
    },
  } as unknown as Database;

  const instances = {
    require: async () => ({}),
    gameDirectory: () => gameDir,
  } as unknown as InstanceService;

  const bus = new EventBus();
  const manager = new ContentManager(makeConfig({ instancesDir: root }), db, instances, bus, makeLogger());
  return { manager, modsDir, packsDir, overrides };
}

afterEach(() => {
  for (const r of tmpRoots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

describe("ContentManager", () => {
  it("lists mods, distinguishing active vs disabled by filename", async () => {
    const h = newHarness();
    fs.writeFileSync(path.join(h.modsDir, "a.jar"), "x");
    fs.writeFileSync(path.join(h.modsDir, "b.jar.disabled"), "x");

    const entries = await h.manager.list("inst-1", "mod");
    expect(entries).toHaveLength(2);
    const a = entries.find((e) => e.fileName === "a.jar")!;
    const b = entries.find((e) => e.fileName === "b.jar")!;
    expect(a.enabled).toBe(true);
    expect(b.enabled).toBe(false);
  });

  it("reports a clean base name for disabled mods", async () => {
    const h = newHarness();
    fs.writeFileSync(path.join(h.modsDir, "optifine.jar.disabled"), "x");
    const entries = await h.manager.list("inst-1", "mod");
    const optifine = entries.find((e) => e.fileName === "optifine.jar")!;
    expect(optifine.enabled).toBe(false);
  });

  it("toggles a mod off and back on by renaming", async () => {
    const h = newHarness();
    fs.writeFileSync(path.join(h.modsDir, "a.jar"), "x");

    await h.manager.setEnabled("inst-1", "mod", "a.jar", false);
    expect(fs.existsSync(path.join(h.modsDir, "a.jar"))).toBe(false);
    expect(fs.existsSync(path.join(h.modsDir, "a.jar.disabled"))).toBe(true);

    await h.manager.setEnabled("inst-1", "mod", "a.jar", true);
    expect(fs.existsSync(path.join(h.modsDir, "a.jar"))).toBe(true);
    expect(fs.existsSync(path.join(h.modsDir, "a.jar.disabled"))).toBe(false);
  });

  it("remove deletes both the active and disabled variants of a mod", async () => {
    const h = newHarness();
    fs.writeFileSync(path.join(h.modsDir, "a.jar"), "x");
    fs.writeFileSync(path.join(h.modsDir, "a.jar.disabled"), "x");

    await h.manager.remove("inst-1", "mod", "a.jar");
    expect(fs.existsSync(path.join(h.modsDir, "a.jar"))).toBe(false);
    expect(fs.existsSync(path.join(h.modsDir, "a.jar.disabled"))).toBe(false);
  });

  it("reject path-traversal file names", async () => {
    const h = newHarness();
    await expect(h.manager.setEnabled("inst-1", "mod", "../evil.jar", false)).rejects.toThrow();
    await expect(h.manager.remove("inst-1", "mod", "a/b.jar")).rejects.toThrow();
  });

  it("resource packs default to enabled and persist overrides", async () => {
    const h = newHarness();
    fs.writeFileSync(path.join(h.packsDir, "packs.zip"), "x");

    const before = await h.manager.list("inst-1", "resourcepack");
    expect(before[0]!.enabled).toBe(true);

    await h.manager.setEnabled("inst-1", "resourcepack", "packs.zip", false);
    const after = await h.manager.list("inst-1", "resourcepack");
    expect(after[0]!.enabled).toBe(false);
  });

  it("returns an empty list when the content directory does not exist", async () => {
    const h = newHarness();
    fs.rmSync(h.modsDir, { recursive: true, force: true });
    await expect(h.manager.list("inst-1", "mod")).resolves.toEqual([]);
  });

  it("imports an uploaded jar via a readable stream", async () => {
    const h = newHarness();
    const savedName = await h.manager.import(
      "inst-1",
      "mod",
      "drag-me.jar",
      Readable.from(Buffer.from("jar-bytes")),
    );
    expect(savedName).toBe("drag-me.jar");
    expect(fs.readFileSync(path.join(h.modsDir, "drag-me.jar"), "utf8")).toBe("jar-bytes");
  });

  it("strips a client-supplied directory prefix on import", async () => {
    const h = newHarness();
    const savedName = await h.manager.import(
      "inst-1",
      "mod",
      "../sneaky/evil.jar",
      Readable.from([Buffer.from("x")]),
    );
    expect(savedName).toBe("evil.jar");
    expect(fs.existsSync(path.join(h.modsDir, "evil.jar"))).toBe(true);
  });

  it("rejects an import whose extension does not match the kind", async () => {
    const h = newHarness();
    await expect(
      h.manager.import("inst-1", "mod", "packs.zip", Readable.from([Buffer.from("x")])),
    ).rejects.toThrow(/only accepts/);
  });

  it("refuses to overwrite an existing file on import", async () => {
    const h = newHarness();
    fs.writeFileSync(path.join(h.modsDir, "a.jar"), "existing");
    await expect(
      h.manager.import("inst-1", "mod", "a.jar", Readable.from([Buffer.from("new")])),
    ).rejects.toThrow(/already exists/);
    expect(fs.readFileSync(path.join(h.modsDir, "a.jar"), "utf8")).toBe("existing");
  });
});