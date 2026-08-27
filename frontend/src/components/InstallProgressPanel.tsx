import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { installStore } from "../stores/installStore";
import { useInstall, useInstallControl } from "../hooks/queries";
import { AppIcon } from "../design-system/AppIcon";
import { fmtBytes, fmtEta, fmtSpeed } from "../lib/format";
import type { InstallPhase } from "../api/types";
import { toast } from "../stores/toastStore";

const PHASE_LABEL: Record<InstallPhase, string> = {
  CREATED: "等待中",
  ANALYZING: "分析版本",
  PLANNING: "生成安装计划",
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

const RUNNING_PHASES: InstallPhase[] = [
  "ANALYZING",
  "PLANNING",
  "PREPARING",
  "DOWNLOADING",
  "INSTALLING",
  "FINALIZING",
  "RETRYING",
  "CANCELLING",
];

// Phases where the cancel button should still be shown — including PAUSED, so
// the user can abandon a paused install without needing to resume first (#5).
const CANCELABLE_PHASES: InstallPhase[] = [
  ...RUNNING_PHASES,
  "PAUSED",
];

const TERMINAL_PHASES: InstallPhase[] = ["READY", "FAILED", "CANCELLED"];

export function InstallProgressPanel({ instanceId }: { instanceId: string }) {
  const snap = installStore((s) => s.active[instanceId]);
  const install = useInstall();
  const control = useInstallControl();
  const [confirmCancel, setConfirmCancel] = useState(false);

  // No live session: render a lightweight "尚未安装/修复可安装" row instead.
  if (!snap) {
    return (
      <Card sx={{ p: 2.5, display: "flex", alignItems: "center", gap: 1.5 }}>
        <AppIcon name="download" size={22} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            实例尚未安装
          </Typography>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            下载并安装游戏主体、加载器与依赖文件，完成后即可启动。
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AppIcon name="rocket_launch" size={16} />}
          disabled={install.isPending}
          onClick={() =>
            install.mutate(instanceId, {
              onError: (err) => toast.error(err instanceof Error ? err.message : "启动安装失败"),
            })
          }
        >
          {install.isPending ? "启动中…" : "开始安装"}
        </Button>
      </Card>
    );
  }

  const running = RUNNING_PHASES.includes(snap.phase);
  const indeterminate = !["DOWNLOADING", "PAUSED"].includes(snap.phase);

  return (
    <Card sx={{ p: 2.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1.5 }}>
        {running ? (
          <CircularProgress size={22} thickness={4} />
        ) : (
          <AppIcon name={snap.phase === "FAILED" ? "error" : snap.phase === "READY" ? "check_circle" : "pause_circle"} size={22} />
        )}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {PHASE_LABEL[snap.phase]}
          </Typography>
          {snap.message ? (
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {snap.message}
            </Typography>
          ) : (
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {snap.tasksDone}/{snap.tasksTotal} 项 · {fmtBytes(snap.downloadedBytes)} / {fmtBytes(snap.totalBytes)}
              {snap.speedBps > 0 ? ` · ${fmtSpeed(snap.speedBps)}` : ""}
              {snap.etaSec !== null ? ` · 剩余 ${fmtEta(snap.etaSec)}` : ""}
            </Typography>
          )}
        </Box>
      </Box>

      <LinearProgress
        variant={indeterminate ? "indeterminate" : "determinate"}
        value={indeterminate ? undefined : snap.progressPct}
        sx={{ mb: 2 }}
      />

      {snap.phase === "FAILED" && (
        <Box sx={{ mb: 2, p: 1.5, borderRadius: 2, bgcolor: "error.container", color: "error.onContainer" }}>
          <Typography variant="caption" sx={{ wordBreak: "break-all" }}>
            {snap.error ?? "安装失败"}
          </Typography>
        </Box>
      )}

      <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1 }}>
        {snap.phase === "PAUSED" && (
          <Button size="small" startIcon={<AppIcon name="play_arrow" size={16} />} onClick={() => control.mutate({ id: instanceId, action: "resume" })}>
            继续
          </Button>
        )}
        {snap.phase === "DOWNLOADING" && (
          <Button size="small" startIcon={<AppIcon name="pause" size={16} />} onClick={() => control.mutate({ id: instanceId, action: "pause" })}>
            暂停
          </Button>
        )}
        {CANCELABLE_PHASES.includes(snap.phase) && !TERMINAL_PHASES.includes(snap.phase) && (
          <Button size="small" color="error" startIcon={<AppIcon name="close" size={16} />} onClick={() => setConfirmCancel(true)}>
            取消
          </Button>
        )}
      </Box>

      <Dialog open={confirmCancel} onClose={() => setConfirmCancel(false)} maxWidth="xs" fullWidth>
        <DialogTitle>确定取消安装吗？</DialogTitle>
        <DialogContent>
          <DialogContentText>
            已下载的 <b>{fmtBytes(snap.downloadedBytes)}</b> 文件会保留在全局缓存中，下次安装可继续复用，不会被删除。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmCancel(false)}>继续安装</Button>
          <Button
            color="error"
            autoFocus
            onClick={() => {
              setConfirmCancel(false);
              control.mutate({ id: instanceId, action: "cancel" });
            }}
          >
            取消安装
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}