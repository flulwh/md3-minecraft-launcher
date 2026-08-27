/**
 * CrashDiagnostics — the analytical brain of the Process Supervisor.
 *
 * Converts a dying process (raw exit code + captured log tail) into a structured,
 * human-actionable diagnosis: which category of failure, how severe, what the
 * log evidence was, and a concrete recommended fix.
 *
 * Kept pure so it can be unit-tested without spawning anything, and so the
 * exact same classifier drives both the in-app diagnosis and the generated
 * crash report.
 */

export type CrashCategory =
  | "oom"
  | "jvm_crash"
  | "invalid_jvm_argument"
  | "java_version"
  | "loader_startup"
  | "missing_component"
  | "mod_error"
  | "network_error"
  | "unknown";

export type CrashSeverity = "fatal" | "warning" | "info";

export interface CrashFinding {
  category: CrashCategory;
  severity: CrashSeverity;
  summary: string;
  detail: string;
  /** Auto-fixable by the Launch Engine (JVM args, Java selection, etc.). */
  autoFixable: boolean;
  suggestedFix?: string;
}

export interface ExitCodeAnalysis {
  code: number | null;
  signal: string | null;
  described: string;
  severity: CrashSeverity;
}

export interface CrashInput {
  exitCode: number | null;
  signal: string | null;
  /** Ring-buffer tail of captured log lines (most recent last). */
  logTail: string[];
  loader: string;
  minecraftVersion: string;
  javaMajor: number;
}

export interface CrashDiagnosis {
  exitCode: ExitCodeAnalysis;
  findings: CrashFinding[];
  /** Highest-severity finding drives the headline. */
  headline: CrashFinding;
  /** The JVM-provenance evidence (hs_err, exception traces) that backs the verdict. */
  evidence: string[];
}

interface Matcher {
  category: CrashCategory;
  severity: CrashSeverity;
  summary: string;
  detail: string;
  autoFixable: boolean;
  suggestedFix?: string;
  /** Regex tested against the whole tail (case-insensitive, multiline). */
  patterns: RegExp[];
}

const MATCHERS: Matcher[] = [
  {
    category: "oom",
    severity: "fatal",
    summary: "Java 内存不足（OutOfMemoryError）",
    detail: "JVM 在堆/元空间耗尽后终止，通常是内存分配过大或过小导致。",
    autoFixable: true,
    suggestedFix: "在「Java & JVM」设置中增大最大内存，或降低游戏渲染/视距以减小内存占用。",
    patterns: [
      /OutOfMemoryError/i,
      /GC overhead limit exceeded/i,
      /There is insufficient memory for the Java Runtime Environment to continue/i,
      /Failed to allocate memory for the current thread/i,
    ],
  },
  {
    category: "jvm_crash",
    severity: "fatal",
    summary: "Java 虚拟机崩溃（Native Crash）",
    detail: "JVM 在 native 层崩溃（hs_err_*.log 已生成），通常是原生库、驱动或 Java 版本与图形栈不匹配。",
    autoFixable: false,
    suggestedFix: "查看日志目录中的 hs_err_pid*.log，尝试切换其他 Java 版本或更新显卡驱动。",
    patterns: [
      /A fatal error has been detected by the Java Runtime Environment/i,
      /hs_err_pid/i,
      /SIGSEGV|SIGILL|SIGBUS|SIGFPE/i,
      /# Problematic frame/i,
    ],
  },
  {
    category: "invalid_jvm_argument",
    severity: "fatal",
    summary: "JVM 启动参数不受当前 Java 支持",
    detail: "存在当前 Java 版本无法识别的 VM 参数，导致 JVM 拒绝启动。",
    autoFixable: true,
    suggestedFix: "Launch Engine 已在启动前自动移除不兼容参数；若仍出现，请检查用户自定义 JVM 参数。",
    patterns: [
      /Unrecognized (?:VM )?option/i,
      /Unrecognized option/i,
      /Could not create the Java Virtual Machine/i,
      /Error: A fatal exception has occurred/i,
    ],
  },
  {
    category: "java_version",
    severity: "fatal",
    summary: "Java 版本与 Minecraft 不兼容",
    detail: "被选中的 Java 无法加载主类/类文件，常见于版本过旧或过新。",
    autoFixable: true,
    suggestedFix: "在实例设置中切换到该 Minecraft 版本推荐的 Java（或使用「自动选择」）。",
    patterns: [
      /UnsupportedClassVersionError/i,
      /Cannot load main class/i,
      /Bad major version/i,
      /Exception in thread "main" java\.lang\.NoClassDefFoundError/i,
    ],
  },
  {
    category: "mod_error",
    severity: "warning",
    summary: "模组加载出错",
    detail: "某个模组缺失依赖、崩溃或版本冲突，导致游戏在加载阶段退出。",
    autoFixable: false,
    suggestedFix: "查看崩溃报告中标记的模组，检查其依赖是否齐全或版本是否冲突。",
    patterns: [
      /net\.fabricmc\.loader.*(?:Exception|Error)/i,
      /Missing required (?:mod|block|item|dependency)/i,
      /Mod resolution exception/i,
      /missing\.mod/i,
    ],
  },
  {
    category: "loader_startup",
    severity: "warning",
    summary: "加载器（Loader）启动失败",
    detail: "Forge / Fabric / NeoForge 在初始化加载器或修补客户端时失败。",
    autoFixable: false,
    suggestedFix: "尝试重装该加载器版本，或更换加载器版本后重试。",
    patterns: [
      /Failed to initialize ModLauncher/i,
      /Could not load or find main class .*[Ff]orge/i,
      /modlauncher\.ModLauncher.*Exception/i,
      /The installer ran into an error/i,
      /Unable to locate classes/i,
    ],
  },
  {
    category: "missing_component",
    severity: "warning",
    summary: "缺少游戏文件或资源",
    detail: "启动所需的客户端文件、库或资源缺失或损坏。",
    autoFixable: true,
    suggestedFix: "在启动器中对实例执行「修复」以重新下载缺失组件。",
    patterns: [
      /Couldn't (?:find|load) .*asset|File .* not found|Compliance.*asset/i,
      /Missing.*\.jar/i,
      /no libraries/i,
      /Failed to download/i,
    ],
  },
  {
    category: "network_error",
    severity: "warning",
    summary: "网络异常导致启动失败",
    detail: "启动过程中出现网络连接或下载错误。",
    autoFixable: false,
    suggestedFix: "检查网络连接，或切换到可用镜像源后重试。",
    patterns: [
      /Connection (?:refused|reset|timed out)/i,
      /UnknownHostException/i,
      /java\.net\.SocketException/i,
    ],
  },
];

/** Describes an exit code in human terms. */
export function describeExitCode(code: number | null, signal: string | null): ExitCodeAnalysis {
  if (signal) {
    return { code, signal, described: `被信号 ${signal} 终止`, severity: "warning" };
  }
  if (code === 0) {
    return { code, signal, described: "正常退出（exit 0）", severity: "info" };
  }
  if (code === 137) {
    return { code, signal, described: "exit 137 — 被系统强制终止（常见于内存耗尽 OOM-kill）", severity: "fatal" };
  }
  if (code === 1 || code === 255) {
    return { code, signal, described: `exit ${code} — Java/Minecraft 异常退出`, severity: "fatal" };
  }
  if (code !== null && code > 128) {
    return { code, signal, described: `exit ${code} — 通常表示进程被信号 ${code - 128} 终止`, severity: "warning" };
  }
  return { code, signal, described: `exit ${code ?? "?"} — 非零退出`, severity: "warning" };
}

/**
 * Analyzes a crashed process. The first matching, highest-severity finding wins
 * the headline; all matches are reported so the report is exhaustive.
 */
export function analyzeCrash(input: CrashInput): CrashDiagnosis {
  const joined = input.logTail.join("\n");
  const evidence = extractEvidence(input.logTail);

  const findings: CrashFinding[] = [];
  for (const m of MATCHERS) {
    if (m.patterns.some((re) => re.test(joined))) {
      findings.push({
        category: m.category,
        severity: m.severity,
        summary: m.summary,
        detail: m.detail,
        autoFixable: m.autoFixable,
        ...(m.suggestedFix ? { suggestedFix: m.suggestedFix } : {}),
      });
    }
  }

  // Loader-specific attribution: weight loader_name into the preamble but rely
  // on pattern matchers above for the actual verdict.
  if (findings.length === 0) {
    findings.push({
      category: "unknown",
      severity: "fatal",
      summary: "Minecraft 启动失败",
      detail: `进程中未捕获到可识别的错误模式（exit ${input.exitCode ?? "?"}）。`,
      autoFixable: false,
    });
  }

  const bySeverity = { fatal: 3, warning: 2, info: 1 } as const;
  findings.sort((a, b) => bySeverity[b.severity] - bySeverity[a.severity]);

  const exitCode = describeExitCode(input.exitCode, input.signal);

  // An OOM-kill (137) without a matching log line still reads as OOM.
  if (exitCode.severity === "fatal" && input.exitCode === 137 && !findings.some((f) => f.category === "oom")) {
    findings.unshift({
      category: "oom",
      severity: "fatal",
      summary: "Java 内存不足（OOM-kill）",
      detail: "进程被操作系统以 exit 137 强制终止，通常是物理内存耗尽。",
      autoFixable: true,
      suggestedFix: "减少内存分配，关闭其他占用内存的软件，或增大系统可用内存。",
    });
  }

  return {
    exitCode,
    findings,
    headline: findings[0]!,
    evidence,
  };
}

/** Pulls the most diagnostic log lines (exceptions, JVM notes). */
function extractEvidence(tail: string[]): string[] {
  const keep: string[] = [];
  for (const line of tail) {
    if (
      /Exception|Error|Caused by|Fatal|hs_err|#[ ]+/i.test(line) ||
      /at [a-z][a-z0-9_$.]+\.[A-Z]/.test(line) // stack frame
    ) {
      keep.push(line);
    }
    if (keep.length >= 40) break;
  }
  return keep;
}

/** Renders a Markdown crash report suitable for writing to disk. */
export function renderCrashReport(input: CrashInput, diag: CrashDiagnosis): string {
  const lines: string[] = [];
  lines.push(`# Minecraft 崩溃报告`);
  lines.push("");
  lines.push(`- **时间**: ${new Date().toISOString()}`);
  lines.push(`- **Minecraft**: ${input.minecraftVersion}`);
  lines.push(`- **加载器**: ${input.loader}`);
  lines.push(`- **Java 主版本**: ${input.javaMajor}`);
  lines.push(`- **退出**: ${diag.exitCode.described}`);
  lines.push("");
  lines.push(`## 诊断`);
  lines.push("");
  for (const f of diag.findings) {
    lines.push(`### [${f.severity.toUpperCase()}] ${f.summary}`);
    lines.push("");
    lines.push(f.detail);
    if (f.suggestedFix) {
      lines.push("");
      lines.push(`- **建议**: ${f.suggestedFix}`);
    }
    lines.push("");
  }
  if (diag.evidence.length) {
    lines.push(`## 关键日志`);
    lines.push("");
    lines.push("```");
    lines.push(...diag.evidence.slice(0, 40));
    lines.push("```");
  }
  return `${lines.join("\n")}\n`;
}