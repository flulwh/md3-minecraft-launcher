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
import { useInstall, useInstallControl, useInstance } from "../hooks/queries";
import { AppIcon } from "../design-system/AppIcon";
import { fmtBytes, fmtEta, fmtSpeed } from "../lib/format";
import { INSTALL_PHASE_LABEL, INSTALL_TERMINAL_PHASES } from "../lib/installPhase";
import type { InstallPhase } from "../api/types";
import { toast } from "../stores/toastStore";

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

export function InstallProgressPanel({ instanceId }: { instanceId: string }) {
  const snap = installStore((s) => s.active[instanceId]);
  const install = useInstall();
  const control = useInstallControl();
  const instance = useInstance(instanceId);
  const [confirmCancel, setConfirmCancel] = useState(false);

  // No live session: derive the row from the persisted instance status instead of
  // always showing "尚未安装" — terminal installs are cleared from installStore,
  // so a READY instance must render as "已安装", not as uninstalled.
  if (!snap) {
    const status = instance.data?.status;
    const installed = status === "READY";
    const broken = status === "BROKEN";
    const installing = status === "INSTALLING" || status === "UPDATING";
    const title = installed
      ? "实例已安装"
      : broken
        ? "实例安装异常"
        : installing
          ? "正在安装中…"
          : "实例尚未安装";
    const caption = installed
      ? "游戏主体、加载器与依赖已就绪，可直接启动。"
      : broken
        ? instance.data?.lastError ?? "安装过程中出现问题，可重新安装修复。"
        : installing
          ? "后台正在下载并安装游戏文件，完成后即可启动。"
          : "创建实例后会自动开始安装；若未开始，可点击下方按钮。";
    return (
      <Card sx={{ p: 2.5, display: "flex", alignItems: "center", gap: 1.5 }}>
        <Box
          sx={{
            display: "inline-flex",
            color: installed ? "success.main" : broken ? "error.main" : "inherit",
          }}
        >
          <AppIcon
            name={installed ? "check_circle" : broken ? "error" : installing ? "sync" : "download"}
            size={22}
          />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {title}
          </Typography>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {caption}
          </Typography>
        </Box>
        {!installed && !installing && (
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
            {install.isPending ? "启动中…" : broken ? "重新安装" : "开始安装"}
          </Button>
        )}
      </Card>
    );
  }

  const running = RUNNING_PHASES.includes(snap.phase);
  // Determinate when bytes are meaningful: the DOWNLOADING phase, a paused
  // install, or the PREPARING phase once the loader build reports real sizes.
  const indeterminate =
    !["DOWNLOADING", "PAUSED"].includes(snap.phase) &&
    !(snap.phase === "PREPARING" && snap.totalBytes > 0);

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
            {INSTALL_PHASE_LABEL[snap.phase]}
          </Typography>
          {snap.message ? (
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {snap.message}
              {snap.totalBytes > 0
                ? ` · ${fmtBytes(snap.downloadedBytes)} / ${fmtBytes(snap.totalBytes)}${snap.speedBps > 0 ? ` · ${fmtSpeed(snap.speedBps)}` : ""}`
                : ""}
            </Typography>
          ) : (
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {snap.totalBytes > 0
                ? `${snap.tasksDone}/${snap.tasksTotal} 项 · ${fmtBytes(snap.downloadedBytes)} / ${fmtBytes(snap.totalBytes)}`
                : `${snap.tasksDone}/${snap.tasksTotal} 项 · 正在计算安装大小…`}
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
        {CANCELABLE_PHASES.includes(snap.phase) && !INSTALL_TERMINAL_PHASES.includes(snap.phase) && (
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