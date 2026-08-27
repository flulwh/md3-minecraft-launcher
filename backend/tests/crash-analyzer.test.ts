import { describe, expect, it } from "vitest";
import {
  analyzeCrash,
  describeExitCode,
  renderCrashReport,
} from "../src/core/process/crash-analyzer.js";

const base = {
  loader: "forge",
  minecraftVersion: "26.2",
  javaMajor: 17,
};

describe("crash-analyzer", () => {
  it("classifies an OutOfMemoryError as OOM and auto-fixable", () => {
    const diag = analyzeCrash({
      ...base,
      exitCode: 1,
      signal: null,
      logTail: [
        "[14:00:00] [Client thread/INFO]: Loading",
        "[14:00:01] [Client thread/ERROR]: java.lang.OutOfMemoryError: Java heap space",
      ],
    });
    expect(diag.headline.category).toBe("oom");
    expect(diag.headline.autoFixable).toBe(true);
    expect(diag.headline.suggestedFix).toMatch(/内存/);
  });

  it("classifies an unrecognized VM option as invalid_jvm_argument", () => {
    const diag = analyzeCrash({
      ...base,
      exitCode: 1,
      signal: null,
      logTail: [
        "Unrecognized VM option 'UseCompactObjectHeaders'",
        "Error: Could not create the Java Virtual Machine.",
      ],
    });
    expect(diag.headline.category).toBe("invalid_jvm_argument");
    expect(diag.headline.autoFixable).toBe(true);
  });

  it("treats exit 137 as an OOM-kill even without a matching log line", () => {
    const diag = analyzeCrash({
      ...base,
      exitCode: 137,
      signal: null,
      logTail: ["[14:00:00] [Client thread/INFO]: init"],
    });
    expect(diag.headline.category).toBe("oom");
    expect(diag.exitCode.described).toMatch(/137/);
  });

  it("falls back to unknown when no pattern matches", () => {
    const diag = analyzeCrash({
      ...base,
      exitCode: 1,
      signal: null,
      logTail: ["[14:00:00] [Client thread/INFO]: some unrelated line"],
    });
    expect(diag.headline.category).toBe("unknown");
    expect(diag.findings.length).toBeGreaterThan(0);
  });

  it("renders a markdown crash report that includes the diagnosis and evidence", () => {
    const tail = ["[14:00:00] [Client thread/ERROR]: java.lang.OutOfMemoryError: Java heap space"];
    const diag = analyzeCrash({ ...base, exitCode: 1, signal: null, logTail: tail });
    const md = renderCrashReport({ ...base, exitCode: 1, signal: null, logTail: tail }, diag);
    expect(md).toMatch("# Minecraft 崩溃报告");
    expect(md).toMatch(/内存不足/);
    expect(md).toMatch(/OutOfMemoryError/);
  });

  it("describes exit codes in human terms", () => {
    expect(describeExitCode(0, null).severity).toBe("info");
    expect(describeExitCode(137, null).severity).toBe("fatal");
    expect(describeExitCode(null, "SIGSEGV").described).toMatch(/SIGSEGV/);
  });
});