import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import InputBase from "@mui/material/InputBase";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import { useMemo, useState } from "react";
import { AppIcon } from "../design-system/AppIcon";
import { PageHeader } from "../design-system/PageHeader";
import { StateView } from "../design-system/StateView";
import { DownloadTaskRow } from "../components/DownloadTaskRow";
import { useDownloads } from "../hooks/queries";
import { fmtSpeed } from "../lib/format";

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
        emptyTitle={tasks.length === 0 ? "暂无下载任务" : "没有匹配的任务"}
        emptyDescription={
          tasks.length === 0
            ? "启动实例或修复游戏时，文件下载任务会实时显示在这里"
            : undefined
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
