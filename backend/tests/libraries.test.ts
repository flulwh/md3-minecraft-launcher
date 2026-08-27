import { describe, it, expect } from "vitest";
import path from "node:path";
import { LibraryResolver } from "../src/core/libraries/library-resolver.js";
import type { Library } from "../src/core/version/types.js";
import { makeConfig, makeEnv } from "./helpers.js";

const resolver = new LibraryResolver(makeConfig());
const libsDir = makeConfig().librariesDir;
function libFile(rel: string): string {
  return path.join(libsDir, rel);
}

describe("LibraryResolver", () => {
  it("resolves a modern artifact into a classpath entry", () => {
    const libs: Library[] = [
      {
        name: "com.mojang:brigadier:1.0.18",
        downloads: {
          artifact: {
            path: "com/mojang/brigadier/1.0.18/brigadier-1.0.18.jar",
            sha1: "deadbeef",
            size: 123,
            url: "https://example.com/brigadier.jar",
          },
        },
      },
    ];
    const res = resolver.resolve(libs, makeEnv());
    expect(res.classpath).toHaveLength(1);
    expect(res.classpath[0]!.artifact.file).toBe(
      libFile("com/mojang/brigadier/1.0.18/brigadier-1.0.18.jar"),
    );
    expect(res.natives).toHaveLength(0);
  });

  it("resolves legacy maven coordinates when downloads is absent", () => {
    const libs: Library[] = [{ name: "com.mojang:patchy:1.1" }];
    const res = resolver.resolve(libs, makeEnv());
    expect(res.classpath[0]!.artifact.file).toBe(libFile("com/mojang/patchy/1.1/patchy-1.1.jar"));
  });

  it("adds the platform native classifier to natives (not classpath)", () => {
    const libs: Library[] = [
      {
        name: "org.lwjgl:lwjgl:3.2.1",
        natives: { windows: "natives-windows", linux: "natives-linux" },
        downloads: {
          classifiers: {
            "natives-windows": {
              path: "org/lwjgl/lwjgl/3.2.1/lwjgl-3.2.1-natives-windows.jar",
              sha1: "n",
              size: 9,
              url: "https://example.com/n.jar",
            },
          },
        },
      },
    ];
    const res = resolver.resolve(libs, makeEnv({ os: "windows" }));
    expect(res.classpath).toHaveLength(0);
    expect(res.natives).toHaveLength(1);
    expect(res.natives[0]!.artifact.file).toBe(
      libFile("org/lwjgl/lwjgl/3.2.1/lwjgl-3.2.1-natives-windows.jar"),
    );
  });

  it("keeps both the artifact and native for a combined library", () => {
    const libs: Library[] = [
      {
        name: "org.lwjgl:lwjgl:3.2.1",
        natives: { windows: "natives-windows" },
        downloads: {
          artifact: {
            path: "org/lwjgl/lwjgl/3.2.1/lwjgl-3.2.1.jar",
            sha1: "a",
            size: 1,
            url: "https://example.com/lwjgl.jar",
          },
          classifiers: {
            "natives-windows": {
              path: "org/lwjgl/lwjgl/3.2.1/lwjgl-3.2.1-natives-windows.jar",
              sha1: "b",
              size: 1,
              url: "https://example.com/n.jar",
            },
          },
        },
      },
    ];
    const res = resolver.resolve(libs, makeEnv({ os: "windows" }));
    expect(res.classpath).toHaveLength(1);
    expect(res.natives).toHaveLength(1);
  });

  it("skips libraries whose rules exclude the current platform", () => {
    const libs: Library[] = [
      {
        name: "com.example:linuxonly:1.0",
        rules: [{ action: "allow", os: { name: "linux" } }],
        downloads: { artifact: { path: "x.jar", sha1: "s", size: 1, url: "u" } },
      },
    ];
    const res = resolver.resolve(libs, makeEnv({ os: "windows" }));
    expect(res.classpath).toHaveLength(0);
    expect(res.skipped).toHaveLength(1);
    expect(res.skipped[0]!.reason).toBe("rules");
  });
});
