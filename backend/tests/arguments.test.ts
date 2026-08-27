import { describe, it, expect } from "vitest";
import { JvmArgumentResolver } from "../src/core/arguments/jvm-argument-resolver.js";
import { GameArgumentResolver } from "../src/core/arguments/game-argument-resolver.js";
import type { ArgumentEntry } from "../src/core/version/types.js";
import type { VariableMap } from "../src/core/arguments/variable-substitution.js";
import { makeLogger, makeEnv } from "./helpers.js";

const jvm = new JvmArgumentResolver(makeLogger());
const game = new GameArgumentResolver(makeLogger());

const baseVars: VariableMap = {
  natives_directory: "C:/natives",
  classpath: "C:/cp/client.jar",
  launcher_name: "NodeLauncher",
  launcher_version: "0.1.0",
  auth_player_name: "Steve",
  version_name: "1.16.5",
};

describe("JvmArgumentResolver", () => {
  it("builds a legacy baseline when no modern jvm arguments exist", () => {
    const out = jvm.build(undefined, baseVars, makeEnv(), { extraJvmArgs: [] });
    expect(out).toContain("-Djava.library.path=C:/natives");
    expect(out).toContain("-cp");
    expect(out).toContain("C:/cp/client.jar");
  });

  it("always ensures launcher identity and log4j hardening flags", () => {
    const out = jvm.build([], baseVars, makeEnv(), { extraJvmArgs: [] });
    expect(out.some((a) => a.startsWith("-Dminecraft.launcher.brand="))).toBe(true);
    expect(out.some((a) => a.startsWith("-Dminecraft.launcher.version="))).toBe(true);
    expect(out.some((a) => a.includes("log4j2.formatMsgNoLookups"))).toBe(true);
  });

  it("adds memory flags when none are present", () => {
    const out = jvm.build([], baseVars, makeEnv(), { maxMemoryMb: 2048, minMemoryMb: 1024, extraJvmArgs: [] });
    expect(out).toContain("-Xmx2048M");
    expect(out).toContain("-Xms1024M");
  });

  it("does not duplicate memory flags when the version already declares them", () => {
    const modern: ArgumentEntry[] = ["-Xmx1024M"];
    const out = jvm.build(modern, baseVars, makeEnv(), { maxMemoryMb: 4096, extraJvmArgs: [] });
    expect(out.filter((a) => a.startsWith("-Xmx")).length).toBe(1);
  });

  it("filters entries by os rules (last match wins)", () => {
    const modern: ArgumentEntry[] = [
      "-XX:+UnlockExperimentalVMOptions",
      { rules: [{ action: "allow", os: { name: "windows" } }], value: "-Xincgc" },
      { rules: [{ action: "allow", os: { name: "linux" } }], value: "-Xlinuxonly" },
    ];
    const out = jvm.build(modern, baseVars, makeEnv({ os: "windows" }), { extraJvmArgs: [] });
    expect(out).toContain("-Xincgc");
    expect(out).not.toContain("-Xlinuxonly");
  });

  it("appends user-supplied extra jvm args", () => {
    const out = jvm.build([], baseVars, makeEnv(), { extraJvmArgs: ["-Da=b", "  ", "-Dc=d"] });
    expect(out).toContain("-Da=b");
    expect(out).toContain("-Dc=d");
  });
});

describe("GameArgumentResolver", () => {
  it("substitutes variables in modern game arguments", () => {
    const modern: ArgumentEntry[] = ["--username", "${auth_player_name}", "--version", "${version_name}"];
    const out = game.build(modern, undefined, baseVars, makeEnv());
    expect(out).toEqual(["--username", "Steve", "--version", "1.16.5"]);
  });

  it("honours os rules in modern game arguments", () => {
    const modern: ArgumentEntry[] = [
      "--width",
      { rules: [{ action: "allow", os: { name: "windows" } }], value: "854" },
    ];
    const out = game.build(modern, undefined, baseVars, makeEnv({ os: "windows" }));
    expect(out).toContain("854");
  });

  it("tokenizes and substitutes a legacy minecraftArguments string", () => {
    const out = game.build(
      undefined,
      "--username ${auth_player_name} --version ${version_name}",
      baseVars,
      makeEnv(),
    );
    expect(out).toEqual(["--username", "Steve", "--version", "1.16.5"]);
  });
});
