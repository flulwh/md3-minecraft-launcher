import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Slider from "@mui/material/Slider";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import { createFilterOptions } from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import type { LoaderId, ManifestVersion } from "../api/types";
import { FormRow } from "../design-system/FormRow";
import {
  useCreateInstance,
  useJavaRuntimes,
  useLoaderVersions,
  useLoaders,
  useSettings,
  useVersions,
} from "../hooks/queries";
import { toast } from "../stores/toastStore";
import { MEMORY_PRESETS_MB } from "../theme/tokens";

const filterLimit = createFilterOptions<ManifestVersion>({ limit: 120 });

/** Memory flags configured via the dedicated slider; reject them in free-text JVM args (#5). */
const MEMORY_JVM_RE = /^-X(?:mx|ms|ss)[0-9.]+[kmgt]?$/i;

export interface CreateInstanceDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (instanceId: string) => void;
}

export function CreateInstanceDialog({ open, onClose, onCreated }: CreateInstanceDialogProps) {
  const [includeSnapshots, setIncludeSnapshots] = useState(false);
  const releases = useVersions({ type: "release", limit: 2000 });
  const snapshots = useVersions({ type: "snapshot", limit: 300 });
  const loaders = useLoaders();
  const settings = useSettings();
  const java = useJavaRuntimes();

  const [name, setName] = useState("");
  const [version, setVersion] = useState<ManifestVersion | null>(null);
  const [loader, setLoader] = useState<LoaderId>("vanilla");
  const [loaderVersion, setLoaderVersion] = useState<string | null>(null);
  const [memory, setMemory] = useState<number>(2048);
  const [javaPath, setJavaPath] = useState<string>("");
  const [width, setWidth] = useState("854");
  const [height, setHeight] = useState("480");
  const [fullscreen, setFullscreen] = useState(false);
  const [serverIp, setServerIp] = useState("");
  const [jvmArgsText, setJvmArgsText] = useState("");

  const create = useCreateInstance();
  const loaderVersions = useLoaderVersions(
    loader === "vanilla" ? undefined : loader,
    version?.id,
  );

  const versionOptions = useMemo(() => {
    const rel = releases.data?.versions ?? [];
    if (!includeSnapshots) return rel;
    return [...(snapshots.data?.versions ?? []), ...rel];
  }, [releases.data, snapshots.data, includeSnapshots]);

  useEffect(() => {
    if (!open) return;
    setName("");
    setVersion(null);
    setLoader("vanilla");
    setLoaderVersion(null);
    setMemory(settings.data?.defaultMemoryMaxMb ?? 2048);
    setJavaPath("");
    setWidth("854");
    setHeight("480");
    setFullscreen(false);
    setServerIp("");
    setJvmArgsText("");
  }, [open, settings.data?.defaultMemoryMaxMb]);

  useEffect(() => {
    if (version && !name) setName(`Minecraft ${version.id}`);
  }, [version, name]);

  useEffect(() => {
    setLoaderVersion(null);
  }, [loader, version?.id]);

  // Detect -Xmx/-Xms/-Xss in the free-text JVM args so the user sees a clear
  // conflict with the "最大内存" slider instead of an unpredictable override (#5).
  const jvmMemoryConflict = useMemo(() => {
    if (!jvmArgsText.trim()) return null;
    return (
      jvmArgsText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .find((s) => MEMORY_JVM_RE.test(s)) ?? null
    );
  }, [jvmArgsText]);

  const canSubmit = Boolean(name.trim() && version && (loader === "vanilla" || loaderVersion) && !jvmMemoryConflict);

  const submit = (): void => {
    if (!version) return;
    create.mutate(
      {
        name: name.trim(),
        minecraftVersion: version.id,
        ...(loader !== "vanilla" && loaderVersion ? { loader, loaderVersion } : {}),
        memoryMaxMb: memory,
        memoryMinMb: Math.max(256, Math.floor(memory / 2)),
        ...(javaPath ? { javaPath } : {}),
        ...(Number(width) >= 320 && Number(height) >= 240
          ? { width: Number(width), height: Number(height) }
          : {}),
        fullscreen,
        ...(serverIp.trim() ? { serverIp: serverIp.trim() } : {}),
        ...(jvmArgsText.trim()
          ? { jvmArgs: jvmArgsText.split("\n").map((s) => s.trim()).filter(Boolean) }
          : {}),
      },
      {
        onSuccess: (inst) => {
          toast.success(`实例「${inst.name}」已创建，正在自动安装…`);
          onClose();
          onCreated?.(inst.id);
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : "创建失败"),
      },
    );
  };

  return (
    <Dialog open={open} onClose={create.isPending ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>创建新实例</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 0.5, pt: 1 }}>
        <FormRow label="Minecraft 版本" htmlFor="ci-version">
          <Autocomplete
            id="ci-version"
            size="small"
            options={versionOptions}
            getOptionLabel={(o) => o.id}
            filterOptions={filterLimit}
            value={version}
            onChange={(_e, v) => setVersion(v)}
            renderOption={(props, o) => (
              <li {...props} key={o.id}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  {o.id}
                  {o.type !== "release" && (
                    <Chip size="small" variant="outlined" label={o.type} sx={{ height: 18, fontSize: 11 }} />
                  )}
                </Box>
              </li>
            )}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder={releases.isLoading ? "加载版本列表…" : "搜索或选择版本"}
                helperText={
                  releases.data
                    ? `最新正式版 ${releases.data.latest.release}`
                    : undefined
                }
              />
            )}
            slotProps={{ paper: { sx: { maxHeight: 320 } } }}
          />
          <Box sx={{ display: "flex", alignItems: "center", mt: 0.5 }}>
            <Switch size="small" checked={includeSnapshots} onChange={(e) => setIncludeSnapshots(e.target.checked)} slotProps={{ input: { "aria-label": "包含快照版本" } }} />
            <Box component="span" sx={{ typography: "caption", color: "text.secondary" }}>包含快照版本</Box>
          </Box>
        </FormRow>

        <FormRow label="实例名称" htmlFor="ci-name">
          <TextField
            id="ci-name"
            fullWidth
            size="small"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：生存世界 / 模组整合包"
          />
        </FormRow>

        <FormRow label="模组加载器">
          <ToggleButtonGroup
            exclusive
            size="small"
            value={loader}
            onChange={(_e, v: LoaderId | null) => v && setLoader(v)}
            aria-label="模组加载器"
            sx={{ flexWrap: "wrap" }}
          >
            <ToggleButton value="vanilla">原版</ToggleButton>
            {(loaders.data ?? []).map((l) => (
              <ToggleButton key={l.id} value={l.id}>
                {l.displayName}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </FormRow>

        {loader !== "vanilla" && (
          <FormRow label="加载器版本">
            {!version ? (
              <Autocomplete
                size="small"
                disabled
                options={[]}
                value={null}
                onChange={() => undefined}
                renderInput={(params) => (
                  <TextField {...params} placeholder="请先选择 Minecraft 版本" disabled helperText="请先选择 Minecraft 版本，再选择加载器版本" />
                )}
              />
            ) : loaderVersions.isLoading ? (
              <Alert severity="info" icon={<span />}>正在获取 {loader} 版本列表…</Alert>
            ) : (
              <Autocomplete
                size="small"
                options={(loaderVersions.data?.versions ?? []).map((v) => v.id)}
                value={loaderVersion}
                onChange={(_e, v) => setLoaderVersion(v)}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    placeholder={loaderVersions.data?.versions.length === 0 ? `未找到适用于 ${version.id} 的版本` : "选择加载器版本"}
                    error={loaderVersions.data?.versions.length === 0}
                    helperText={
                      loaderVersions.data?.versions.length === 0
                        ? "该 Minecraft 版本可能不受此加载器支持，请更换版本或加载器"
                        : undefined
                    }
                  />
                )}
                disableClearable={false}
              />
            )}
          </FormRow>
        )}

        <FormRow
          label="最大内存"
          description={`${memory} MB`}
          htmlFor="ci-memory"
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
            <Slider
              id="ci-memory"
              value={memory}
              onChange={(_e, v) => setMemory(Array.isArray(v) ? v[0] ?? memory : v)}
              min={512}
              max={8192}
              step={256}
              marks={MEMORY_PRESETS_MB.map((m) => ({ value: m, label: `${m / 1024}G` }))}
              valueLabelDisplay="auto"
              sx={{ flex: 1, mr: 1 }}
            />
            <Chip label={`${(memory / 1024).toFixed(memory % 1024 === 0 ? 0 : 1)} GB`} />
          </Box>
        </FormRow>

        <FormRow label="Java 运行时" htmlFor="ci-java">
          <TextField
            id="ci-java"
            select
            size="small"
            fullWidth
            value={javaPath}
            onChange={(e) => setJavaPath(e.target.value)}
            helperText={
              java.isLoading
                ? "正在扫描已安装的 Java…"
                : (java.data ?? []).length === 0
                  ? "未检测到 Java，可到「设置 → Java 运行时」手动添加可执行文件路径（如 …\\bin\\java.exe）"
                  : undefined
            }
          >
            <MenuItem value="">自动选择（按版本要求）</MenuItem>
            {(java.data ?? []).map((rt) => (
              <MenuItem key={rt.path} value={rt.path}>
                Java {rt.majorVersion} · {rt.architecture}
                {rt.vendor ? ` · ${rt.vendor}` : ""}
              </MenuItem>
            ))}
          </TextField>
        </FormRow>

        <Accordion elevation={0} sx={{ bgcolor: "transparent", "&:before": { display: "none" }, border: 1, borderColor: "divider", borderRadius: 2, mt: 1 }}>
          <AccordionSummary expandIcon={<span aria-hidden>▾</span>} sx={{ typography: "subtitle2", minHeight: 44 }}>
            高级选项
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0, px: 2 }}>
            <FormRow label="窗口尺寸">
              <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                <TextField size="small" type="number" value={width} onChange={(e) => setWidth(e.target.value)} slotProps={{ htmlInput: { min: 320, max: 16384 }, input: { sx: { width: 96 } } }} aria-label="宽度" />
                ×
                <TextField size="small" type="number" value={height} onChange={(e) => setHeight(e.target.value)} slotProps={{ htmlInput: { min: 240, max: 16384 }, input: { sx: { width: 96 } } }} aria-label="高度" />
                <Box sx={{ ml: 1, display: "flex", alignItems: "center" }}>
                  <Switch size="small" checked={fullscreen} onChange={(e) => setFullscreen(e.target.checked)} slotProps={{ input: { "aria-label": "全屏启动" } }} />
                  全屏
                </Box>
              </Box>
            </FormRow>
            <FormRow label="自动连接服务器" description="可选，启动后直接进入该服务器">
              <TextField size="small" fullWidth placeholder="mc.example.com" value={serverIp} onChange={(e) => setServerIp(e.target.value)} />
            </FormRow>
            <FormRow label="额外 JVM 参数" description="每行一条。内存请用上方「最大内存」滑块设置，不要在此填写 -Xmx/-Xms">
              <TextField
                size="small"
                fullWidth
                multiline
                rows={3}
                value={jvmArgsText}
                onChange={(e) => setJvmArgsText(e.target.value)}
                error={Boolean(jvmMemoryConflict)}
                helperText={
                  jvmMemoryConflict
                    ? `「${jvmMemoryConflict}」与「最大内存」设置冲突，请勿重复填写内存参数`
                    : undefined
                }
                placeholder={"-XX:+UseG1GC\n-Dfml.ignoreInvalidMinecraftCertificates=true"}
              />
            </FormRow>
          </AccordionDetails>
        </Accordion>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={create.isPending}>取消</Button>
        <Button variant="contained" disabled={!canSubmit || create.isPending} onClick={submit}>
          {create.isPending ? "创建中…" : "创建实例"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
