import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import InputBase from "@mui/material/InputBase";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { InstanceDto } from "../api/types";
import { CreateInstanceDialog } from "../components/CreateInstanceDialog";
import { ImportInstanceDialog } from "../components/ImportInstanceDialog";
import { InstanceCard } from "../components/InstanceCard";
import { AppIcon } from "../design-system/AppIcon";
import { LoaderChip } from "../design-system/LoaderChip";
import { PageHeader } from "../design-system/PageHeader";
import { StateView } from "../design-system/StateView";
import { useHistorySessions, useInstances, useUpdateInstance } from "../hooks/queries";
import { loaderLabel } from "../lib/format";

type SortKey = "recent" | "name" | "version" | "created";

export function InstancesPage() {
  const instances = useInstances();
  const history = useHistorySessions(50);
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [sort, setSort] = useState<SortKey>("recent");
  const [loaderFilter, setLoaderFilter] = useState<string>("all");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const lastPlayedByInstance = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of history.data?.sessions ?? []) {
      if (!map.has(s.instanceId)) map.set(s.instanceId, s.startedAt);
    }
    return map;
  }, [history.data]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const i of instances.data ?? []) for (const t of i.tags) set.add(t);
    return [...set].sort((a, b) => a.localeCompare(b, "zh-CN"));
  }, [instances.data]);

  const filtered = useMemo(() => {
    let list = [...(instances.data ?? [])];
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.minecraftVersion.toLowerCase().includes(q) ||
          i.loader.toLowerCase().includes(q) ||
          i.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    if (loaderFilter !== "all") list = list.filter((i) => i.loader === loaderFilter);
    if (tagFilter !== "") list = list.filter((i) => i.tags.includes(tagFilter));
    switch (sort) {
      case "name":
        list.sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name, "zh-CN"));
        break;
      case "version":
        list.sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.minecraftVersion.localeCompare(a.minecraftVersion));
        break;
      case "created":
        list.sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.createdAt.localeCompare(a.createdAt));
        break;
      default: {
        list.sort((a, b) => {
          if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
          const ta = lastPlayedByInstance.get(a.id) ?? a.createdAt;
          const tb = lastPlayedByInstance.get(b.id) ?? b.createdAt;
          return tb.localeCompare(ta);
        });
      }
    }
    return list;
  }, [instances.data, query, loaderFilter, tagFilter, sort, lastPlayedByInstance]);

  return (
    <Box sx={{ p: 3, maxWidth: 1200, mx: "auto" }}>
      <PageHeader
        title="实例"
        description="管理你的 Minecraft 实例：版本、加载器、内存与启动"
        actions={
          <>
            <Button
              variant="text"
              startIcon={<AppIcon name="upload_file" size={18} />}
              onClick={() => setImportOpen(true)}
            >
              导入
            </Button>
            <Button variant="contained" startIcon={<AppIcon name="add" filled size={18} />} onClick={() => setCreateOpen(true)}>
              新建实例
            </Button>
          </>
        }
      />

      <Paper sx={{ display: "flex", alignItems: "center", gap: 1.5, p: 1, pl: 1.5, mb: 2.5, flexWrap: "wrap", bgcolor: "surfaceContainerLow" }}>
        <Box sx={{ display: "flex", alignItems: "center", flex: 1, minWidth: 200 }}>
          <AppIcon name="search" size={20} />
          <InputBase
            placeholder="搜索名称 / 版本 / 加载器…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            inputProps={{ "aria-label": "搜索实例" }}
            sx={{ ml: 1, flex: 1 }}
          />
        </Box>

        <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
          {["all", "vanilla", "fabric", "forge", "neoforge", "quilt"].map((l) => (
            <Chip
              key={l}
              size="small"
              label={l === "all" ? "全部" : loaderLabel(l)}
              color={loaderFilter === l ? "primary" : "default"}
              variant={loaderFilter === l ? "filled" : "outlined"}
              onClick={() => setLoaderFilter(l)}
              clickable
            />
          ))}
        </Box>

        <Box sx={{ flexGrow: 1 }} />

        <Select<string>
          size="small"
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          aria-label="按标签筛选"
          displayEmpty
          sx={{ width: 140 }}
        >
          <MenuItem value="">全部标签</MenuItem>
          {allTags.map((t) => (
            <MenuItem key={t} value={t}>#{t}</MenuItem>
          ))}
        </Select>

        <Select<SortKey>
          size="small"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          aria-label="排序方式"
          sx={{ width: 128 }}
        >
          <MenuItem value="recent">按最近游玩</MenuItem>
          <MenuItem value="name">按名称</MenuItem>
          <MenuItem value="version">按版本</MenuItem>
          <MenuItem value="created">按创建时间</MenuItem>
        </Select>

        <ToggleButtonGroup
          exclusive
          size="small"
          value={view}
          onChange={(_e, v: "grid" | "list" | null) => v && setView(v)}
          aria-label="视图切换"
        >
          <Tooltip title="网格视图">
            <ToggleButton value="grid" aria-label="网格视图">
              <AppIcon name="grid_view" size={18} />
            </ToggleButton>
          </Tooltip>
          <Tooltip title="列表视图">
            <ToggleButton value="list" aria-label="列表视图">
              <AppIcon name="view_list" size={18} />
            </ToggleButton>
          </Tooltip>
        </ToggleButtonGroup>
      </Paper>

      <StateView
        loading={instances.isLoading}
        error={instances.error}
        onRetry={() => void instances.refetch()}
        empty={(instances.data?.length ?? 0) === 0}
        emptyIcon="widgets"
        emptyTitle="还没有实例"
        emptyDescription="创建你的第一个 Minecraft 实例，选择版本与加载器即可开始游戏"
        emptyAction={
          <Button variant="contained" startIcon={<AppIcon name="add" filled size={18} />} onClick={() => setCreateOpen(true)}>
            创建实例
          </Button>
        }
      >
        {(instances.data?.length ?? 0) > 0 && filtered.length === 0 ? (
          <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center", py: 6 }}>
            没有符合筛选条件的实例
          </Typography>
        ) : view === "grid" ? (
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 1.5 }}>
            {filtered.map((inst) => (
              <InstanceCard
                key={inst.id}
                instance={inst}
                lastPlayedAt={lastPlayedByInstance.get(inst.id) ?? null}
              />
            ))}
          </Box>
        ) : (
          <Paper sx={{ overflow: "hidden" }}>
            {filtered.map((inst) => (
              <InstanceRow key={inst.id} instance={inst} lastPlayedAt={lastPlayedByInstance.get(inst.id) ?? null} />
            ))}
          </Paper>
        )}
      </StateView>

      <CreateInstanceDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => navigate("/downloads")} />
      <ImportInstanceDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </Box>
  );
}

function InstanceRow({ instance, lastPlayedAt }: { instance: InstanceDto; lastPlayedAt: string | null }) {
  void lastPlayedAt;
  const navigate = useNavigate();
  const updateInstance = useUpdateInstance(instance.id);
  return (
    <Box
      onClick={() => navigate(`/instances/${instance.id}`)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && navigate(`/instances/${instance.id}`)}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        px: 2,
        py: 1.25,
        borderBottom: 1,
        borderColor: "divider",
        cursor: "pointer",
        "&:last-child": { borderBottom: "none" },
        "&:hover": { bgcolor: "surfaceContainerHigh" },
      }}
    >
      <IconButton
        aria-label={instance.favorite ? "取消收藏" : "收藏"}
        size="small"
        color={instance.favorite ? "warning" : "default"}
        onClick={(e) => {
          e.stopPropagation();
          updateInstance.mutate({ favorite: !instance.favorite });
        }}
      >
        <AppIcon name="star" size={18} filled={instance.favorite} />
      </IconButton>
      <AppIcon name="sports_esports" size={20} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>{instance.name}</Typography>
          {instance.tags.slice(0, 2).map((t) => (
            <Chip
              key={t}
              size="small"
              variant="outlined"
              icon={<AppIcon name="label" size={11} />}
              label={t}
              sx={{ height: 20, fontSize: 11 }}
            />
          ))}
          {instance.tags.length > 2 && (
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              +{instance.tags.length - 2}
            </Typography>
          )}
        </Box>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          Minecraft {instance.minecraftVersion}
        </Typography>
      </Box>
      <LoaderChip loader={instance.loader} version={null} />
      <Typography variant="caption" sx={{ color: "text.secondary", width: 90, textAlign: "right", flexShrink: 0 }}>
        {instance.memoryMaxMb} MB
      </Typography>
      <IconButton aria-label="打开详情" size="small">
        <AppIcon name="chevron_right" size={18} />
      </IconButton>
    </Box>
  );
}
