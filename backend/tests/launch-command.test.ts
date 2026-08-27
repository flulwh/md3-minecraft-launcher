import { describe, it, expect } from "vitest";
import path from "node:path";
import { LaunchCommandBuilder } from "../src/core/launch/launch-command-builder.js";
import { ClasspathBuilder } from "../src/core/classpath/classpath-builder.js";
import {
  substituteVariables,
  tokenizeArgumentString,
} from "../src/core/arguments/variable-substitution.js";
import { evaluateRules } from "../src/core/libraries/rule-evaluator.js";
import type { ResolvedLibrary } from "../src/core/version/types.js";
import { makeLogger, makeConfig, makeEnv } from "./helpers.js";

function lib(file: string): ResolvedLibrary {
  return { name: file, artifact: { file, urls: [] }, kind: "class" };
}

const TMP = makeConfig().librariesDir;
function libFile(rel: string): string {
  return path.join(TMP, rel);
}

describe("LaunchCommandBuilder", () => {
  const builder = new LaunchCommandBuilder();

  it("assembles java + jvm + mainClass + game args", () => {
    const cmd = builder.build({
      javaPath: "java",
      jvmArgs: ["-Xmx2G"],
      mainClass: "net.minecraft.client.main.Main",
      gameArgs: ["--username", "Steve"],
      cwd: process.cwd(),
    });
    expect(cmd.javaPath).toBe("java");
    expect(cmd.args).toEqual(["-Xmx2G", "net.minecraft.client.main.Main", "--username", "Steve"]);
    expect(cmd.cwd).toBe(process.cwd());
  });

  it("strips NODE_OPTIONS from the spawned env", () => {
    const prev = process.env["NODE_OPTIONS"];
    process.env["NODE_OPTIONS"] = "--max-old-space-size=10";
    try {
      const cmd = builder.build({
        javaPath: "java",
        jvmArgs: [],
        mainClass: "m",
        gameArgs: [],
        cwd: process.cwd(),
      });
      expect(cmd.env["NODE_OPTIONS"]).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env["NODE_OPTIONS"];
      else process.env["NODE_OPTIONS"] = prev;
    }
  });

  it("rejects NUL bytes in the java path", () => {
    expect(() =>
      builder.build({ javaPath: "java\0", jvmArgs: [], mainClass: "m", gameArgs: [], cwd: "." }),
    ).toThrow();
  });

  it("rejects NUL bytes in an argument", () => {
    expect(() =>
      builder.build({
        javaPath: "java",
        jvmArgs: ["ok", "bad\0"],
        mainClass: "m",
        gameArgs: [],
        cwd: ".",
      }),
    ).toThrow();
  });
});

describe("ClasspathBuilder", () => {
  const builder = new ClasspathBuilder(TMP);

  it("joins entries with the platform separator and dedupes", () => {
    const a = lib(libFile("a.jar"));
    const b = lib(libFile("b.jar"));
    const dup = lib(libFile("a.jar"));
    const client = libFile("versions/1.16.5/client.jar");
    const res = builder.build([a, b, dup], client, "windows");
    expect(res.entries).toEqual([libFile("a.jar"), libFile("b.jar"), libFile("versions/1.16.5/client.jar")]);
    expect(res.classpath).toBe(
      [libFile("a.jar"), libFile("b.jar"), libFile("versions/1.16.5/client.jar")].join(";"),
    );
  });

  it("uses ':' as the separator on non-windows platforms", () => {
    const res = builder.build([lib(libFile("a.jar"))], libFile("c/client.jar"), "linux");
    expect(res.classpath).toBe([libFile("a.jar"), libFile("c/client.jar")].join(":"));
  });
});

describe("variable substitution", () => {
  const logger = makeLogger();

  it("replaces ${var} placeholders", () => {
    const out = substituteVariables("hello ${name} on ${os}", { name: "Steve", os: "win" }, logger);
    expect(out).toBe("hello Steve on win");
  });

  it("replaces unknown variables with empty string", () => {
    const out = substituteVariables("a${missing}b", {}, logger);
    expect(out).toBe("ab");
  });

  it("tokenizes a quoted legacy argument string", () => {
    const tokens = tokenizeArgumentString('--server "mc.example.com" --port 25565');
    expect(tokens).toEqual(["--server", "mc.example.com", "--port", "25565"]);
  });
});

describe("rule evaluation", () => {
  const env = makeEnv({ os: "windows", arch: "x86_64" });

  it("allows when there are no rules", () => {
    expect(evaluateRules(undefined, env)).toBe(true);
    expect(evaluateRules([], env)).toBe(true);
  });

  it("honours the last matching rule", () => {
    const rules = [
      { action: "allow" as const, os: { name: "windows" as const } },
      { action: "disallow" as const, os: { name: "windows" as const } },
    ];
    expect(evaluateRules(rules, env)).toBe(false);
  });

  it("skips rules whose os condition does not match", () => {
    const rules = [
      { action: "allow" as const, os: { name: "linux" as const } },
      { action: "allow" as const, os: { name: "windows" as const } },
    ];
    expect(evaluateRules(rules, env)).toBe(true);
  });

  it("evaluates feature requirements", () => {
    const rules = [{ action: "allow" as const, features: { "is_demo_user": true } }];
    expect(evaluateRules(rules, makeEnv({ features: { is_demo_user: false } }))).toBe(false);
    expect(evaluateRules(rules, makeEnv({ features: { is_demo_user: true } }))).toBe(true);
  });
});
