import type { InstallPhase } from "../api/types";

/**
 * Single source of truth for install phase labels/colors shared by every page
 * (instance list cards, detail progress panel, download center) so the same
 * phase always renders identically and updates in sync.
 */
export const INSTALL_PHASE_LABEL: Record<InstallPhase, string> = {
  CREATED: "等待中",
  ANALYZING: "分析版本",
  PLANNING: "生成计划",
  PREPARING: "准备加载器",
  DOWNLOADING: "下载文件",
  INSTALLING: "安装内容",
  FINALIZING: "校验收尾",
  READY: "已就绪",
  PAUSED: "已暂停",
  RETRYING: "重试中",
  CANCELLING: "取消中",
  CANCELLED: "已取消",
  FAILED: "失败",
};

/** Phases that keep a live install row visible. */
export const INSTALL_LIVE_PHASES: InstallPhase[] = [
  "CREATED",
  "ANALYZING",
  "PLANNING",
  "PREPARING",
  "DOWNLOADING",
  "INSTALLING",
  "FINALIZING",
  "PAUSED",
  "RETRYING",
  "CANCELLING",
];

export const INSTALL_TERMINAL_PHASES: InstallPhase[] = ["READY", "FAILED", "CANCELLED"];

export type InstallChipColor = "info" | "warning" | "error" | "success" | "default";

export function installPhaseColor(phase: InstallPhase): InstallChipColor {
  switch (phase) {
    case "PAUSED":
    case "RETRYING":
      return "warning";
    case "CANCELLED":
    case "FAILED":
      return "error";
    case "READY":
      return "success";
    case "CANCELLING":
      return "default";
    default:
      return "info";
  }
}
