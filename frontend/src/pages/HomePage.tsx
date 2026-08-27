import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AppIcon } from "../design-system/AppIcon";
import { LoaderChip } from "../design-system/LoaderChip";
import { SectionHeader } from "./HomeSections";
import { useHistorySessions, useInstances } from "../hooks/queries";
import { fmtBytes, fmtRelative, fmtSpeed } from "../lib/format";
import { launchStore } from "../stores/launchStore";
import { downloadStore } from "../stores/downloadStore";
import { CreateInstanceDialog } from "../components/CreateInstanceDialog";
import { LaunchButton } from "../components/LaunchButton";
import { AccountChip } from "../components/AccountChip";
import { useState } from "react";

export function HomePage() {
  const navigate = useNavigate();
  const instances = useInstances();
  const history = useHistorySessions(50);
  const [createOpen, setCreateOpen] = useState(false);

  const lastPlayedByInstance = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of history.data?.sessions ?? []) {
      if (!map.has(s.instanceId)) map.set(s.instanceId, s.startedAt);
    }
    return map;
  }, [history.data]);

  const currentInstance = useMemo(() => {
    const list = instances.data ?? [];
    if (list.length === 0) return null;
    // Priority: running > last played > first created (UX #7). The previous
    // branch had dead code (`|| last` was always truthy), so a running
    // instance was never surfaced when a last-played instance existed.
    const running = list.find((i) =>
      ["running", "launching", "preparing", "downloading"].includes(launchStore.getState().get(i.id).phase),
    );
    if (running) return running;
    const lastId = [...lastPlayedByInstance.keys()][0];
    const last = list.find((i) => i.id === lastId);
    return last ?? list[0] ?? null;
  }, [instances.data, lastPlayedByInstance]);

  const recent = useMemo(() => {
    const list = instances.data ?? [];
    const sorted = [...list].sort((a, b) => {
      const ta = lastPlayedByInstance.get(a.id) ?? a.createdAt;
      const tb = lastPlayedByInstance.get(b.id) ?? b.createdAt;
      return tb.localeCompare(ta);
    });
    return sorted.filter((i) => i.id !== currentInstance?.id).slice(0, 6);
  }, [instances.data, currentInstance, lastPlayedByInstance]);

  const overrides = downloadStore((s) => s.overrides);
  const activeTasks = Object.values(overrides);
  const topTask = activeTasks.sort((a, b) => b.progressPct - a.progressPct)[0];
  const totalSpeed = activeTasks.reduce((s, t) => s + t.speedBps, 0);

  if (instances.isLoading) {
    return (
      <Box sx={{ p: 3 }}>
        <Card sx={{ p: 4 }}>
          <Box sx={{ height: 28, width: 220, bgcolor: "surfaceContainerHighest", borderRadius: 2, mb: 2 }} />
          <Box sx={{ height: 96, borderRadius: 3, bgcolor: "surfaceContainerHigh" }} />
        </Card>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, maxWidth: 1080, mx: "auto" }}>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 1.5, mb: 2.5 }}>
        <Typography variant="h3">Minecraft</Typography>
        <Chip size="small" variant="outlined" label="Java Edition" sx={{ color: "text.secondary" }} />
      </Box>

      {instances.data && instances.data.length === 0 ? (
        <EmptyHome onCreate={() => setCreateOpen(true)} />
      ) : currentInstance ? (
        <HeroCard
          instanceId={currentInstance.id}
          name={currentInstance.name}
          mcVersion={currentInstance.minecraftVersion}
          loader={currentInstance.loader}
          loaderVersion={currentInstance.loaderVersion}
          memoryMb={currentInstance.memoryMaxMb}
          lastPlayed={lastPlayedByInstance.get(currentInstance.id) ?? null}
          onOpenDetail={() => navigate(`/instances/${currentInstance.id}`)}
        />
      ) : null}

      <Box sx={{ mt: 4 }}>
        <SectionHeader
          title="最近实例"
          trailing={
            <Button size="small" endIcon={<AppIcon name="arrow_forward" size={16} />} onClick={() => navigate("/instances")}>
              全部实例
            </Button>
          }
        />
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(auto-fill, minmax(240px, 1fr))" }, gap: 1.5 }}>
          {recent.map((inst) => (
            <Card
              key={inst.id}
              onClick={() => navigate(`/instances/${inst.id}`)}
              sx={{
                p: 1.75,
                cursor: "pointer",
                "&:hover": { bgcolor: "surfaceContainerHigh", borderColor: "outline" },
                transition: (t) => t.transitions.create("background-color"),
              }}
            >
              <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                {inst.name}
              </Typography>
              <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mt: 0.25 }}>
                MC {inst.minecraftVersion} · {fmtRelative(lastPlayedByInstance.get(inst.id))}
              </Typography>
              <Box sx={{ mt: 1 }}>
                <LoaderChip loader={inst.loader} version={null} />
              </Box>
            </Card>
          ))}
        </Box>
      </Box>

      <Box sx={{ mt: 4 }}>
        <SectionHeader title="下载任务" />
        <Card sx={{ px: 2, py: 1.5 }}>
          {topTask ? (
            <>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
                <Typography variant="body2">
                  共 {activeTasks.length} 个任务进行中 · {fmtSpeed(totalSpeed)}
                </Typography>
                <Button size="small" endIcon={<AppIcon name="arrow_forward" size={16} />} onClick={() => navigate("/downloads")}>
                  查看全部
                </Button>
              </Box>
              <LinearProgress variant="determinate" value={Math.max(3, Math.min(100, topTask.progressPct))} />
              <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mt: 0.5 }}>
                {topTask.kind} · {fmtBytes(topTask.receivedBytes)}
                {topTask.totalBytes !== null ? ` / ${fmtBytes(topTask.totalBytes)}` : ""}
              </Typography>
            </>
          ) : (
            <Typography variant="body2" sx={{ color: "text.secondary", py: 0.5 }}>
              当前没有进行中的下载任务
            </Typography>
          )}
        </Card>
      </Box>

      <CreateInstanceDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={(id) => navigate(`/instances/${id}`)} />
    </Box>
  );
}

function HeroCard(props: {
  instanceId: string;
  name: string;
  mcVersion: string;
  loader: string;
  loaderVersion: string | null;
  memoryMb: number;
  lastPlayed: string | null;
  onOpenDetail: () => void;
}) {
  return (
    <Card
      sx={{
        p: { xs: 2.5, md: 4 },
        bgcolor: "primary.container",
        color: "primary.onContainer",
        border: "none",
        borderRadius: 4,
      }}
    >
      <Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, gap: 3, alignItems: { md: "center" } }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="overline" sx={{ opacity: 0.8 }}>
            当前实例
          </Typography>
          <Typography
            variant="h2"
            component="div"
            onClick={props.onOpenDetail}
            sx={{ cursor: "pointer", mb: 0.5, "&:hover": { textDecoration: "underline" } }}
          >
            {props.name}
          </Typography>
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mt: 1 }}>
            <Chip size="small" label={`Minecraft ${props.mcVersion}`} sx={{ bgcolor: "rgba(255,255,255,0.35)" }} />
            <LoaderChip loader={props.loader} version={props.loaderVersion} />
            <AccountChip instanceId={props.instanceId} />
            <Chip size="small" label={`${fmtBytes(props.memoryMb * 1024 * 1024)} 内存`} sx={{ bgcolor: "rgba(255,255,255,0.35)" }} />
          </Box>
          <Typography variant="body2" sx={{ mt: 1.5, opacity: 0.85 }}>
            上次游玩：{fmtRelative(props.lastPlayed)}
          </Typography>
        </Box>

        <Box sx={{ display: "flex", flexDirection: "column", gap: 1, alignItems: { md: "flex-end" }, flexShrink: 0 }}>
          <LaunchButton instanceId={props.instanceId} size="large" />
          <Button
            size="small"
            onClick={props.onOpenDetail}
            startIcon={<AppIcon name="tune" size={16} />}
            sx={{ color: "inherit" }}
          >
            实例详情与设置
          </Button>
        </Box>
      </Box>
    </Card>
  );
}

function EmptyHome({ onCreate }: { onCreate: () => void }) {
  return (
    <Card sx={{ p: 6, textAlign: "center", border: "none", bgcolor: "surfaceContainerLow" }}>
      <AppIcon name="grass" size={48} filled />
      <Typography variant="h5" sx={{ mt: 1.5 }}>
        还没有 Minecraft 实例
      </Typography>
      <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5, mb: 3 }}>
        创建一个实例，选择版本与加载器，即刻开始游戏
      </Typography>
      <Button variant="contained" size="large" startIcon={<AppIcon name="add" filled size={18} />} onClick={onCreate}>
        创建第一个实例
      </Button>
    </Card>
  );
}
