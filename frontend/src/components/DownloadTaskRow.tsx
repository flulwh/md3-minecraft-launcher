import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type { DownloadTaskSnapshot } from "../api/types";
import { AppIcon } from "../design-system/AppIcon";
import { useDownloadControl } from "../hooks/queries";
import { basename, fmtBytes, fmtEta, fmtSpeed } from "../lib/format";
import { downloadStore } from "../stores/downloadStore";

const KIND_META: Record<string, { icon: string; label: string }> = {
  client: { icon: "sports_esports", label: "游戏本体" },
  "client-mappings": { icon: "description", label: "映射表" },
  library: { icon: "extension", label: "组件库" },
  native: { icon: "memory", label: "本地库" },
  "asset-index": { icon: "list_alt", label: "资源索引" },
  asset: { icon: "image", label: "资源文件" },
  "log-config": { icon: "receipt_long", label: "日志配置" },
  "java-runtime": { icon: "coffee", label: "Java 运行时" },
  loader: { icon: "puzzle", label: "加载器" },
  other: { icon: "file_download", label: "其他" },
};

const STATUS_LABEL: Record<string, string> = {
  pending: "等待中",
  downloading: "下载中",
  paused: "已暂停",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

const STATUS_COLOR: Record<string, string> = {
  pending: "text.secondary",
  downloading: "primary.main",
  paused: "warning.main",
  completed: "success.main",
  failed: "error.main",
  cancelled: "text.secondary",
};

const FALLBACK_META = { icon: "file_download", label: "其他" };

export function DownloadTaskRow({ task }: { task: DownloadTaskSnapshot }) {
  const control = useDownloadControl();
  // Subscribe only to this task's live progress so each progress frame only
  // re-renders this row instead of the whole page. This keeps the list smooth
  // (and other pages responsive) while batch asset downloads stream in.
  const live = downloadStore((s) => s.overrides[task.taskId]);
  const t = live ?? task;
  const meta = KIND_META[t.kind] ?? FALLBACK_META;
  const indeterminate = (t.status === "pending" || t.status === "downloading") && t.totalBytes === null;

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "auto minmax(0,1fr) auto",
        gap: { xs: 1, md: 2 },
        alignItems: "center",
        py: 1.25,
        px: 2,
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
        <Box
          sx={{
            width: 34,
            height: 34,
            borderRadius: 2,
            bgcolor: "secondary.container",
            color: "secondary.onContainer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <AppIcon name={meta.icon} size={18} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
            {meta.label}
          </Typography>
          <Tooltip title={t.dest}>
            <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }} noWrap>
              {basename(t.dest)}
              {t.error ? ` · ${t.error}` : ""}
            </Typography>
          </Tooltip>
        </Box>
      </Box>

      <Box sx={{ minWidth: 0 }}>
        <LinearProgress
          variant={indeterminate ? "indeterminate" : "determinate"}
          value={Math.min(100, Math.max(0, t.progressPct))}
          color={t.status === "failed" ? "error" : t.status === "paused" ? "warning" : "primary"}
          sx={{ mb: 0.5 }}
        />
        <Box sx={{ display: "flex", justifyContent: "space-between", typography: "caption", color: "text.secondary" }}>
          <span>
            {fmtBytes(t.receivedBytes)}
            {t.totalBytes !== null ? ` / ${fmtBytes(t.totalBytes)}` : ""}
          </span>
          {(t.status === "downloading") && (
            <span>
              {fmtSpeed(t.speedBps)} · 剩余 {fmtEta(t.etaSec)}
            </span>
          )}
        </Box>
      </Box>

      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        <Typography variant="caption" sx={{ width: 52, textAlign: "right", color: STATUS_COLOR[t.status] ?? "text.secondary", fontWeight: 600 }}>
          {STATUS_LABEL[t.status] ?? t.status}
        </Typography>
        {t.status === "downloading" && (
          <>
            <Tooltip title="暂停">
              <IconButton aria-label={`暂停 ${basename(t.dest)}`} onClick={() => control.mutate({ taskId: t.taskId, action: "pause" })}>
                <AppIcon name="pause" size={18} />
              </IconButton>
            </Tooltip>
            <Tooltip title="取消">
              <IconButton aria-label={`取消 ${basename(t.dest)}`} onClick={() => control.mutate({ taskId: t.taskId, action: "cancel" })}>
                <AppIcon name="close" size={18} />
              </IconButton>
            </Tooltip>
          </>
        )}
        {t.status === "paused" && (
          <>
            <Tooltip title="继续">
              <IconButton aria-label={`继续 ${basename(t.dest)}`} onClick={() => control.mutate({ taskId: t.taskId, action: "resume" })}>
                <AppIcon name="play_arrow" filled size={18} />
              </IconButton>
            </Tooltip>
            <Tooltip title="取消">
              <IconButton aria-label={`取消 ${basename(t.dest)}`} onClick={() => control.mutate({ taskId: t.taskId, action: "cancel" })}>
                <AppIcon name="close" size={18} />
              </IconButton>
            </Tooltip>
          </>
        )}
      </Box>
    </Box>
  );
}