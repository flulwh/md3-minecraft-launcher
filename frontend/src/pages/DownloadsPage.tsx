import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import InputBase from "@mui/material/InputBase";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppIcon } from "../design-system/AppIcon";
import { PageHeader } from "../design-system/PageHeader";
import { StateView } from "../design-system/StateView";
import { DownloadTaskRow } from "../components/DownloadTaskRow";
import { installStore } from "../stores/installStore";
import { useDownloads, useInstances } from "../hooks/queries";
import { fmtBytes, fmtSpeed } from "../lib/format";
import type { InstallationSnapshot, InstanceDto, InstallPhase } from "../api/types";

type StatusFilter = "all" | "downloading" | "paused" | "completed" | "failed";

const FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "downloading", label: "进行中" },
  { key: "paused", label: "已暂停" },
  { key: "completed", label: "已完成" },
  { key: "failed", label: "失败" },
];

export function DownloadsPage() {
  const downloads = useDownloads();
  const instances = useInstances();
  const navigate = useNavigate();
  const installs = installStore((s) => s.active);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("downloading");

  const tasks = useMemo(() => {
    if (!downloads.data) return [];
    return downloads.data.tasks
      .slice()
      .sort((a, b) => {
        const rank = (t: { status: string }): number =>
          t.status === "downloading" ? 0 : t.status === "pending" ? 1 : t.status === "paused" ? 2 : t.status === "failed" ? 3 : 4;
        return rank(a) - rank(b);
      });
  }, [downloads.data]);

  const stats = downloads.data?.stats;

  const filtered = useMemo(() => {
    let list = tasks;
    if (statusFilter === "downloading") list = list.filter((t) => ["downloading", "pending"].includes(t.status));
    else if (statusFilter !== "all") list = list.filter((t) => t.status === statusFilter);
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((t) => t.dest.toLowerCase().includes(q) || t.kind.toLowerCase().includes(q));
    return list;
  }, [tasks, statusFilter, query]);

  // Rendering every asset file at once can freeze the UI; cap the rows shown.
  const displayCap = 500;
  const displayed = filtered.slice(0, displayCap);
  const capped = filtered.length > displayCap;

  const activeCount = tasks.filter((t) => t.status === "downloading").length;

  return (
    <Box sx={{ p: 3, maxWidth: 1000, mx: "auto" }}>
      <PageHeader title="下载" description="游戏文件、组件库与资源的实时下载任务" />

      <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", mb: 2.5 }}>
        <StatCard icon="download" label="进行中" value={String(activeCount + (stats?.queued ?? 0))} />
        <StatCard icon="speed" label="总速度" value={fmtSpeed(stats?.aggregateSpeedBps ?? 0)} />
        <StatCard icon="check_circle" label="已完成" value={String(stats?.completedTotal ?? 0)} />
        <StatCard icon="error" label="失败" value={String(stats?.failedTotal ?? 0)} />
      </Box>

      <ActiveInstalls installs={installs} instances={instances.data ?? []} navigate={navigate} />

      <Paper sx={{ display: "flex", alignItems: "center", gap: 1.5, p: 1, pl: 1.5, mb: 2, flexWrap: "wrap", bgcolor: "surfaceContainerLow" }}>
        <AppIcon name="search" size={20} />
        <InputBase
          placeholder="按文件名或类型筛选…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          inputProps={{ "aria-label": "筛选下载任务" }}
          sx={{ flex: 1, minWidth: 160 }}
        />
        <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
          {FILTERS.map((f) => (
            <Chip
              key={f.key}
              size="small"
              clickable
              label={f.label}
              variant={statusFilter === f.key ? "filled" : "outlined"}
              color={statusFilter === f.key ? "primary" : "default"}
              onClick={() => setStatusFilter(f.key)}
            />
          ))}
        </Box>
      </Paper>

      <StateView
        loading={downloads.isLoading}
        error={downloads.error}
        onRetry={() => void downloads.refetch()}
        skeleton={
          <Card>
            {[1, 2, 3].map((n) => (
              <Box key={n} sx={{ px: 2, py: 2, borderBottom: 1, borderColor: "divider" }}>
                <Skeleton height={28} />
                <Skeleton height={8} />
              </Box>
            ))}
          </Card>
        }
        empty={filtered.length === 0}
        emptyIcon="cloud_off"
        emptyTitle={
          tasks.length === 0
            ? "暂无下载任务"
            : statusFilter === "downloading"
              ? "当前没有进行中的下载"
              : "没有匹配的任务"
        }
        emptyDescription={
          tasks.length === 0
            ? "启动实例或修复游戏时，文件下载任务会实时显示在这里"
            : statusFilter === "downloading"
              ? "所有下载任务都已完成，历史记录仍保留在「已完成」中，不会丢失"
              : undefined
        }
        emptyAction={
          statusFilter === "downloading" && tasks.length > 0 ? (
            <Button variant="contained" onClick={() => setStatusFilter("completed")}>
              查看已完成下载
            </Button>
          ) : undefined
        }
      >
        <Paper sx={{ overflow: "hidden" }} role="list">
          {capped && (
            <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: "divider", color: "text.secondary", fontSize: 13 }}>
              显示前 {displayCap} 条，共 {filtered.length} 条（使用搜索或筛选缩小范围）
            </Box>
          )}
          {displayed.map((task) => (
            <Box role="listitem" key={task.taskId}>
              <DownloadTaskRow task={task} />
            </Box>
          ))}
        </Paper>
      </StateView>
    </Box>
  );
}

function StatCard({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <Card sx={{ px: 2.5, py: 1.5, display: "flex", alignItems: "center", gap: 1.5, flex: 1, minWidth: 150 }}>
      <Box
        sx={{
          width: 36,
          height: 36,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: "secondary.container",
          color: "secondary.onContainer",
        }}
      >
        <AppIcon name={icon} size={19} />
      </Box>
      <Box>
        <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
          {label}
        </Typography>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {value}
        </Typography>
      </Box>
    </Card>
  );
}

const LIVE_PHASES: InstallPhase[] = [
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

const INSTALL_PHASE_LABEL: Record<string, string> = {
  ANALYZING: "分析版本",
  PLANNING: "生成计划",
  PREPARING: "准备加载器",
  DOWNLOADING: "下载中",
  INSTALLING: "安装中",
  FINALIZING: "收尾",
  PAUSED: "已暂停",
  RETRYING: "重试中",
  CANCELLING: "取消中",
};

/** "下载中心" 正在安装的实例（聚合 install.progress 事件） */
function ActiveInstalls({
  installs,
  instances,
  navigate,
}: {
  installs: Record<string, InstallationSnapshot>;
  instances: InstanceDto[];
  navigate: (to: string) => void;
}) {
  const live = Object.values(installs).filter((s) => LIVE_PHASES.includes(s.phase));
  if (live.length === 0) return null;

  return (
    <Card sx={{ mb: 2.5, overflow: "hidden" }}>
      <Box sx={{ px: 2.5, pt: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 1 }}>
          <AppIcon name="download" size={18} />
          正在安装的实例
        </Typography>
      </Box>
      {live.map((s) => {
        const inst = instances.find((i) => i.id === s.instanceId);
        const phase = s.phase === "DOWNLOADING" ? "download" : "other";
        // Loader build (PREPARING) reports live byte progress from the adapter,
        // so render a determinate bar once the expected size is known.
        const determinate = phase === "download" || (s.phase === "PREPARING" && s.totalBytes > 0);
        return (
          <Box
            key={s.instanceId}
            sx={{ px: 2.5, py: 2, borderTop: 1, borderColor: "divider" }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {inst?.name ?? "实例"}
                  <Box component="span" sx={{ color: "text.secondary", fontWeight: 400 }}>
                    {" "}
                    {inst ? `· ${inst.minecraftVersion}${inst.loader !== "vanilla" ? ` · ${inst.loader}` : ""}` : ""}
                  </Box>
                </Typography>
              </Box>
              <Chip size="small" label={INSTALL_PHASE_LABEL[s.phase] ?? s.phase} color={s.phase === "PAUSED" ? "warning" : s.phase === "CANCELLING" ? "default" : "info"} />
            </Box>
            {determinate ? (
              <LinearProgress variant="determinate" value={s.progressPct} sx={{ mb: 1 }} />
            ) : (
              <LinearProgress variant="indeterminate" sx={{ mb: 1 }} />
            )}
            {s.message ? (
              <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 0.5 }}>
                {s.message}
              </Typography>
            ) : null}
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {s.totalBytes > 0
                  ? `${fmtBytes(s.downloadedBytes)} / ${fmtBytes(s.totalBytes)}`
                  : "正在计算安装大小…"}
              </Typography>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                {s.speedBps > 0 && (
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    {fmtSpeed(s.speedBps)}
                  </Typography>
                )}
                <Button size="small" onClick={() => navigate(`/instances/${s.instanceId}`)}>
                  查看详情
                </Button>
              </Box>
            </Box>
          </Box>
        );
      })}
    </Card>
  );
}
