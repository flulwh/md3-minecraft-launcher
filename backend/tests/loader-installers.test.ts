import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ForgeAdapter } from "../src/core/loaders/installer-adapters.js";
import { VersionMetadataStore } from "../src/core/version/version-metadata-store.js";
import { makeConfig, makeLogger } from "./helpers.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempVersionsDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "launcher-forge-validate-"));
  tempDirs.push(dir);
  return dir;
}

describe("ForgeAdapter.validate", () => {
  it("accepts an installed inheriting profile without requiring a sibling jar", async () => {
    const versionsDir = makeTempVersionsDir();
    const versionId = "forge-1.20.1-47.2.0";
    const config = makeConfig({ versionsDir });
    const store = new VersionMetadataStore(
      config,
      {} as never,
      {} as never,
      makeLogger(),
    );
    const adapter = new ForgeAdapter(
      config,
      {} as never,
      store,
      {} as never,
      makeLogger(),
    );

    fs.mkdirSync(path.join(versionsDir, versionId), { recursive: true });
    fs.writeFileSync(
      path.join(versionsDir, versionId, `${versionId}.json`),
      JSON.stringify({
        id: versionId,
        inheritsFrom: "1.20.1",
        mainClass: "cpw.mods.bootstraplauncher.BootstrapLauncher",
      }),
    );

    await expect(adapter.validate(versionId)).resolves.toBe(true);
  });
});
