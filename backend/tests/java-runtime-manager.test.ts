import { describe, it, expect } from "vitest";
import { JavaRuntimeManager } from "../src/core/java/java-runtime-manager.js";
import { makeConfig, makeLogger } from "./helpers.js";

// fallbackMajorFor only touches the version string; nulls for the I/O-bound
// dependencies are fine, cast through unknown to satisfy the TS ctor types.
const manager = new JavaRuntimeManager(
  makeConfig(),
  makeLogger(),
) as unknown as Pick<JavaRuntimeManager, "fallbackMajorFor">;

describe("JavaRuntimeManager.fallbackMajorFor", () => {
  it.each([
    ["pre-1.x snapshots", "a1.2.5", 8],
    ["1.7.10", "1.7.10", 8],
    ["1.12.2", "1.12.2", 8],
    ["1.16.5", "1.16.5", 8],
    ["1.17", "1.17", 16],
    ["1.17.1", "1.17.1", 16],
    ["1.18.2", "1.18.2", 17],
    ["1.19.4", "1.19.4", 17],
    ["1.20", "1.20", 21],
    ["1.20.4", "1.20.4", 21],
    ["1.20.6", "1.20.6", 21],
    ["1.21", "1.21", 21],
    ["1.21.4", "1.21.4", 21],
    ["future 2.x (unversioned)", "2.0", 21],
  ])("%s (%s) -> Java %d", (_label, version, expected) => {
    expect(manager.fallbackMajorFor(version)).toBe(expected);
  });
});