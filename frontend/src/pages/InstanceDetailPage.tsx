import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Slider from "@mui/material/Slider";
import Switch from "@mui/material/Switch";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { InstanceDto } from "../api/types";
import { AppIcon } from "../design-system/AppIcon";
import { ConfirmDialog } from "../design-system/ConfirmDialog";
import { FormRow } from "../design-system/FormRow";
import { LoaderChip } from "../design-system/LoaderChip";
import { StateView } from "../design-system/StateView";
import { LogViewer } from "../components/LogViewer";
import { LaunchButton } from "../components/LaunchButton";
import { ContentListPanel } from "../components/ContentListPanel";
import { wsClient } from "../ws/wsClient";
import {
  useDeleteInstance,
  useInstance,
  useJavaRuntimes,
  useRepairInstance,
  useUpdateInstance,
} from "../hooks/queries";
import { previewLaunch, stopSession } from "../lib/actions";
import { fmtBytes, fmtDateTime, loaderLabel } from "../lib/format";
import { launchStore } from "../stores/launchStore";
import { repairStore } from "../stores/repairStore";
import { toast } from "../stores/toastStore";

type DetailTab = "overview" | "mods" | "resourcepacks" | "log" | "settings";

export function InstanceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const instance = useInstance(id);
  const tabFromQuery = searchParams.get("tab");
  const [tab, setTab] = useState<DetailTab>(
    tabFromQuery === "settings"
      ? "settings"
      : tabFromQuery === "log"
        ? "log"
        : tabFromQuery === "mods"
          ? "mods"
          : tabFromQuery === "resourcepacks"
            ? "resourcepacks"
            : "overview",
  );
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Filter the WS event stream to this instance while the detail page is open.
  useEffect(() => {
    if (!id) return;
    wsClient.subscribe(id);
    return () => wsClient.unsubscribe();
  }, [id]);

  const deleteInstance = useDeleteInstance();
  const phase = launchStore((s) => (id ? (s.byInstance[id]?.phase ?? "idle") : "idle"));
  const runningLike = ["running", "launching", "preparing", "downloading"].includes(phase);

  if (!id || instance.isLoading) {
    return (
      <Box sx={{ p: 3 }}>
        <Card sx={{ height: 160 }} />
      </Box>
    );
  }

  if (instance.isError || !instance.data) {
    return (
      <Box sx={{ p: 3, maxWidth: 900, mx: "auto" }}>
        <StateView loading={false} error={instance.error} onRetry={() => void instance.refetch()}>
          <></>
        </StateView>
      </Box>
    );
  }

  const inst = instance.data;

  return (
    <Box sx={{ p: 3, maxWidth: 1000, mx: "auto" }}>
      <Button
        component={Link}
        to="/instances"
        size="small"
        startIcon={<AppIcon name="arrow_back" size={16} />}
        sx={{ mb: 1.5 }}
      >
        返回实例列表
      </Button>

      <Card sx={{ p: { xs: 2.5, md: 3.5 }, bgcolor: "surfaceContainerLow" }}>
        <Box
          sx={{
            display: "flex",
            gap: 2.5,
            alignItems: { md: "center" },
            flexDirection: { xs: "column", md: "row" },
          }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h4">{inst.name}</Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1, flexWrap: "wrap" }}>
              <Chip size="small" label={`Minecraft ${inst.minecraftVersion}`} variant="outlined" />
              <LoaderChip loader={inst.loader} version={inst.loaderVersion} />
              <Chip size="small" variant="outlined" label={`${fmtBytes(inst.memoryMaxMb * 1024 * 1024)} 内存`} />
              {runningLike && (
                <Chip size="small" color="success" label={phase === "running" ? "运行中" : "准备中"} />
              )}
            </Box>
          </Box>
          <Box sx={{ display: "flex", gap: 0.75, alignItems: "center", flexShrink: 0 }}>
            <Button
              size="small"
              aria-label="打开游戏目录"
              startIcon={<AppIcon name="folder_open" size={18} />}
              onClick={() => {
                void window.launcher?.revealItem(inst.gameDir);
              }}
            >
              目录
            </Button>
            {runningLike || phase === "stopping" ? (
              <Button
                size="small"
                color="error"
                variant="outlined"
                onClick={() => void stopSession(inst.id)}
                disabled={phase === "stopping"}
              >
                停止游戏
              </Button>
            ) : (
              <>
                <Button
                  size="small"
                  variant="text"
                  onClick={() =>
                    void previewLaunch(inst.id).then(() => {
                      const pf = launchStore.getState().get(inst.id).lastPreflight;
                      const failed = pf?.filter((c) => !c.ok) ?? [];
                      if (pf && pf.length > 0 && failed.length === 0) toast.success("预检通过，环境就绪");
                      else if (failed.length > 0) toast.warning(`预检发现 ${failed.length} 个问题`);
                    })
                  }
                >
                  预检
                </Button>
                <LaunchButton instanceId={inst.id} />
              </>
            )}
          </Box>
        </Box>
        {phase === "crashed" && <AlertCrash instanceId={inst.id} />}
      </Card>

      <Tabs value={tab} onChange={(_e, v: DetailTab) => setTab(v)} sx={{ my: 2 }}>
        <Tab icon={<AppIcon name="info" size={17} />} iconPosition="start" label="概览" value="overview" />
        <Tab icon={<AppIcon name="extension" size={17} />} iconPosition="start" label="Mods" value="mods" />
        <Tab icon={<AppIcon name="grid_view" size={17} />} iconPosition="start" label="资源包" value="resourcepacks" />
        <Tab icon={<AppIcon name="terminal" size={17} />} iconPosition="start" label="日志" value="log" />
        <Tab icon={<AppIcon name="tune" size={17} />} iconPosition="start" label="设置" value="settings" />
      </Tabs>

      {tab === "overview" && <OverviewTab instanceId={inst.id} />}
      {tab === "mods" && (
        <ContentListPanel
          instanceId={inst.id}
          kind="mod"
          icon="extension"
          title="Mods"
          subtitle="已安装的模组，关闭后游戏将跳过加载"
          emptyHint="该实例尚未安装任何 Mod，稍后可从市场一键安装"
        />
      )}
      {tab === "resourcepacks" && (
        <ContentListPanel
          instanceId={inst.id}
          kind="resourcepack"
          icon="grid_view"
          title="资源包"
          subtitle="纹理、音效与界面美化资源包"
          emptyHint="该实例尚未安装任何资源包"
        />
      )}
      {tab === "log" && <LogViewer instanceId={inst.id} />}
      {tab === "settings" && (
        <SettingsForm key={inst.id} inst={inst} onDeleted={() => navigate("/instances")} />
      )}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`删除实例「${inst.name}」？`}
        danger
        confirmText="删除"
        loading={deleteInstance.isPending}
        message="将同时删除该实例的本地游戏文件（含存档与配置），此操作不可恢复。"
        onConfirm={() => deleteInstance.mutate(inst.id, { onSuccess: () => navigate("/instances") })}
      />
    </Box>
  );
}

function AlertCrash({ instanceId }: { instanceId: string }) {
  const crashReason = launchStore((s) => s.byInstance[instanceId]?.crashReason);
  return (
    <Box sx={{ mt: 2, p: 1.75, borderRadius: 2, bgcolor: "error.container", color: "error.onContainer" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, typography: "body2", fontWeight: 600 }}>
        <AppIcon name="report" size={18} filled />
        上次启动异常退出
      </Box>
      <Typography variant="caption" sx={{ display: "block", mt: 0.5, wordBreak: "break-all" }}>
        {crashReason ?? "未知原因"}
      </Typography>
    </Box>
  );
}

function OverviewTab({ instanceId }: { instanceId: string }) {
  const preflight = launchStore((s) => s.byInstance[instanceId]?.lastPreflight);
  const instance = useInstance(instanceId);
  if (!instance.data) return null;
  const inst = instance.data;
  void instanceId;
  return (
    <Card sx={{ p: 2.5 }}>
      {preflight && preflight.length > 0 && (
        <>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            最近预检结果
          </Typography>
          <Box sx={{ mb: 2 }}>
            {preflight.map((c) => (
              <Chip
                key={c.name}
                size="small"
                sx={{ mr: 0.75, mb: 0.75 }}
                color={c.ok ? "success" : "error"}
                variant="outlined"
                label={
                  <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                    <AppIcon name={c.ok ? "check_circle" : "cancel"} size={14} />
                    {`${c.name}${c.detail ? ` — ${c.detail}` : ""}`}
                  </span>
                }
              />
            ))}
          </Box>
        </>
      )}
      <Box component="dl" sx={{ m: 0 }}>
        <FormRow label="游戏目录">
          <DirPath path={inst.gameDir} />
        </FormRow>
        <FormRow label="版本信息">
          <Typography variant="body2">
            Minecraft {inst.minecraftVersion}
            {inst.loader !== "vanilla" ? ` · ${loaderLabel(inst.loader)}${inst.loaderVersion ? ` ${inst.loaderVersion}` : ""}` : ""}
          </Typography>
        </FormRow>
        <FormRow label="内存分配">
          <Typography variant="body2">
            最小 {inst.memoryMinMb ?? "-"} MB · 最大 {inst.memoryMaxMb} MB
          </Typography>
        </FormRow>
        <FormRow label="窗口模式">
          <Typography variant="body2">
            {inst.fullscreen
              ? "全屏"
              : inst.width && inst.height
                ? `${inst.width} × ${inst.height}`
                : "默认尺寸"}
          </Typography>
        </FormRow>
        <FormRow label="自动连接服务器">
          <Typography variant="body2">{inst.serverIp ?? "未设置"}</Typography>
        </FormRow>
        <FormRow label="JVM 参数">
          {inst.jvmArgs.length > 0 ? (
            <Box component="ul" sx={{ m: 0, pl: 2 }}>
              {inst.jvmArgs.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </Box>
          ) : (
            <Typography variant="body2">无自定义参数</Typography>
          )}
        </FormRow>
        <FormRow label="创建时间">
          <Typography variant="body2">{fmtDateTime(inst.createdAt)}</Typography>
        </FormRow>
      </Box>
    </Card>
  );
}

function DirPath({ path }: { path: string }) {
  return (
    <Tooltip title="点击复制路径">
      <Typography
        component="span"
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && void window.launcher?.writeText(path)}
        onClick={() => void window.launcher?.writeText(path)}
        sx={{
          fontFamily: "monospace",
          cursor: "pointer",
          fontSize: 12.5,
          wordBreak: "break-all",
          "&:hover": { textDecoration: "underline" },
        }}
      >
        {path}
      </Typography>
    </Tooltip>
  );
}

interface SettingsFormProps {
  inst: InstanceDto;
  onDeleted: () => void;
}

function SettingsForm({ inst, onDeleted }: SettingsFormProps) {
  const update = useUpdateInstance(inst.id);
  const java = useJavaRuntimes();
  const repair = useRepairInstance(inst.id);
  const repairProgress = repairStore((s) => s.active[inst.id]);
  const deleteInstance = useDeleteInstance();

  const [name, setName] = useState(inst.name);
  const [memory, setMemory] = useState(inst.memoryMaxMb);
  const [javaPath, setJavaPath] = useState(inst.javaPath ?? "");
  const [serverIp, setServerIp] = useState(inst.serverIp ?? "");
  const [fullscreen, setFullscreen] = useState(inst.fullscreen);
  const [width, setWidth] = useState(String(inst.width ?? ""));
  const [height, setHeight] = useState(String(inst.height ?? ""));
  const [jvmArgsText, setJvmArgsText] = useState(inst.jvmArgs.join("\n"));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [repairOpen, setRepairOpen] = useState(false);

  const dirty =
    name !== inst.name ||
    memory !== inst.memoryMaxMb ||
    serverIp !== (inst.serverIp ?? "") ||
    fullscreen !== inst.fullscreen ||
    javaPath !== (inst.javaPath ?? "") ||
    jvmArgsText !== inst.jvmArgs.join("\n") ||
    width !== String(inst.width ?? "") ||
    height !== String(inst.height ?? "");

  const buildPatch = () => ({
    ...(name.trim() !== inst.name ? { name: name.trim() } : {}),
    memoryMaxMb: memory,
    javaPath,
    serverIp: serverIp.trim() || undefined,
    fullscreen,
    ...(width !== "" && Number(width) >= 320 ? { width: Number(width) } : {}),
    ...(height !== "" && Number(height) >= 240 ? { height: Number(height) } : {}),
    jvmArgs: jvmArgsText.split("\n").map((s) => s.trim()).filter(Boolean),
  });

  const reset = (): void => {
    setName(inst.name);
    setMemory(inst.memoryMaxMb);
    setJavaPath(inst.javaPath ?? "");
    setServerIp(inst.serverIp ?? "");
    setFullscreen(inst.fullscreen);
    setWidth(String(inst.width ?? ""));
    setHeight(String(inst.height ?? ""));
    setJvmArgsText(inst.jvmArgs.join("\n"));
  };

  return (
    <Card sx={{ p: 2.5 }}>
      <FormRow label="名称" htmlFor="st-name">
        <TextField id="st-name" size="small" fullWidth value={name} onChange={(e) => setName(e.target.value)} />
      </FormRow>

      <FormRow label="版本与加载器" description="如需更换，建议新建实例以避免文件冲突">
        <Chip size="small" variant="outlined" label={`Minecraft ${inst.minecraftVersion} · ${loaderLabel(inst.loader)}`} />
      </FormRow>

      <FormRow label="最大内存" description={`${memory} MB`}>
        <Slider
          value={memory}
          onChange={(_e, v) => setMemory(Array.isArray(v) ? v[0] ?? memory : v)}
          min={512}
          max={8192}
          step={256}
          marks={[
            { value: 1024, label: "1G" },
            { value: 4096, label: "4G" },
            { value: 8192, label: "8G" },
          ]}
          valueLabelDisplay="auto"
        />
      </FormRow>

      <FormRow label="Java 运行时" htmlFor="st-java">
        <TextField id="st-java" select size="small" fullWidth value={javaPath} onChange={(e) => setJavaPath(e.target.value)}>
          <MenuItem value="">自动选择（按版本要求）</MenuItem>
          {(java.data ?? []).map((rt) => (
            <MenuItem key={rt.path} value={rt.path}>
              Java {rt.majorVersion} · {rt.architecture}
              {rt.vendor ? ` · ${rt.vendor}` : ""}
            </MenuItem>
          ))}
        </TextField>
      </FormRow>

      <FormRow label="窗口尺寸">
        <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
          <TextField
            size="small"
            type="number"
            placeholder="宽"
            value={width}
            onChange={(e) => setWidth(e.target.value)}
            slotProps={{ htmlInput: { min: 320, max: 16384 } }}
            sx={{ width: 110 }}
            aria-label="窗口宽度"
          />
          ×
          <TextField
            size="small"
            type="number"
            placeholder="高"
            value={height}
            onChange={(e) => setHeight(e.target.value)}
            slotProps={{ htmlInput: { min: 240, max: 16384 } }}
            sx={{ width: 110 }}
            aria-label="窗口高度"
          />
          <Box sx={{ ml: 1, display: "flex", alignItems: "center", gap: 0.5 }}>
            <Switch size="small" checked={fullscreen} onChange={(e) => setFullscreen(e.target.checked)} slotProps={{ input: { "aria-label": "全屏启动" } }} />
            全屏
          </Box>
        </Box>
      </FormRow>

      <FormRow label="自动连接服务器">
        <TextField size="small" fullWidth placeholder="留空则不自动连接" value={serverIp} onChange={(e) => setServerIp(e.target.value)} />
      </FormRow>

      <FormRow label="额外 JVM 参数" description="每行一条，例如 -XX:+UseG1GC">
        <TextField size="small" multiline rows={3} fullWidth value={jvmArgsText} onChange={(e) => setJvmArgsText(e.target.value)} />
      </FormRow>

      <Box sx={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 1, mt: 1.5 }}>
        {dirty && (
          <Typography variant="caption" sx={{ color: "warning.main" }}>
            有未保存的更改
          </Typography>
        )}
        <Button disabled={!dirty || update.isPending} onClick={reset}>
          放弃
        </Button>
        <Button
          variant="contained"
          disabled={!dirty || update.isPending}
          onClick={() =>
            update.mutate(buildPatch(), {
              onSuccess: () => toast.success("设置已保存"),
              onError: (err) => toast.error(err instanceof Error ? err.message : "保存失败"),
            })
          }
        >
          保存更改
        </Button>
      </Box>

      <Box sx={{ mt: 3, pt: 2.5, borderTop: 1, borderColor: "divider", display: "flex", alignItems: "center", gap: 1.5 }}>
        <AppIcon name="healing" size={20} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            修复游戏文件
          </Typography>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            校验并重新下载缺失或损坏的库、资源与本地库
          </Typography>
          {repair.isPending && repairProgress && (
            <Box sx={{ mt: 1 }}>
              <LinearProgress
                variant={repairProgress.total > 0 ? "determinate" : "indeterminate"}
                value={
                  repairProgress.total > 0
                    ? Math.round((repairProgress.current / repairProgress.total) * 100)
                    : undefined
                }
              />
              <Typography variant="caption" sx={{ color: "text.secondary", mt: 0.5, display: "block" }}>
                {repairProgress.stage} {repairProgress.current}/{repairProgress.total}
              </Typography>
            </Box>
          )}
        </Box>
        <Button
          variant="outlined"
          disabled={repair.isPending}
          startIcon={<AppIcon name="build" size={16} />}
          onClick={() => setRepairOpen(true)}
        >
          修复
        </Button>
      </Box>

      <Box sx={{ mt: 2.5, pt: 2.5, borderTop: 1, borderColor: "divider", display: "flex", alignItems: "center", gap: 1.5 }}>
        <AppIcon name="delete_forever" size={20} />
        <Box sx={{ flex: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            删除此实例
          </Typography>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            仅从启动器移除，不会删除磁盘上的存档与文件
          </Typography>
        </Box>
        <Button variant="outlined" color="error" onClick={() => setConfirmDelete(true)}>
          删除
        </Button>
      </Box>

      <Dialog open={repairOpen} onClose={() => !repair.isPending && setRepairOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>修复游戏文件</DialogTitle>
        <DialogContent sx={{ pb: 1 }}>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            将校验 Minecraft {inst.minecraftVersion} 的客户端、组件库、本地库与资源索引，并重新下载缺失或校验失败的部分。过程可能需要几分钟。
          </Typography>
        </DialogContent>
        <Box sx={{ px: 3, pb: 2.5, display: "flex", justifyContent: "flex-end", gap: 1 }}>
          <Button onClick={() => setRepairOpen(false)} disabled={repair.isPending}>
            取消
          </Button>
          <Button
            variant="contained"
            disabled={repair.isPending}
            onClick={() =>
              repair.mutate(undefined, {
                onSuccess: (r) => {
                  setRepairOpen(false);
                  toast.success(`修复完成，重新下载 ${r.redownloadedLibraries} 个组件`);
                },
                onError: (err) => {
                  setRepairOpen(false);
                  toast.error(err instanceof Error ? err.message : "修复失败");
                },
              })
            }
          >
            {repair.isPending ? "修复中…" : "开始修复"}
          </Button>
        </Box>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`删除实例「${inst.name}」？`}
        danger
        confirmText="删除"
        loading={deleteInstance.isPending}
        message="将同时删除该实例的本地游戏文件（含存档与配置），此操作不可恢复。"
        onConfirm={() => deleteInstance.mutate(inst.id, { onSuccess: onDeleted })}
      />
    </Card>
  );
}
