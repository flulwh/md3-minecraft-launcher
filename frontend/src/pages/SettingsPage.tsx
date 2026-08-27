import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useColorScheme } from "@mui/material/styles";
import { useEffect, useState } from "react";
import { AppIcon } from "../design-system/AppIcon";
import { FormRow } from "../design-system/FormRow";
import { PageHeader } from "../design-system/PageHeader";
import { useJavaRuntimes, useJavaScan, useSaveSettings, useSettings } from "../hooks/queries";
import { toast } from "../stores/toastStore";
import { uiStore, type ThemeMode } from "../stores/uiStore";
import { APP_VERSION } from "../theme/tokens";

const SECTIONS = [
  { key: "general", icon: "settings", label: "常规" },
  { key: "appearance", icon: "palette", label: "外观" },
  { key: "java", icon: "coffee", label: "Java" },
  { key: "downloads", icon: "download", label: "下载" },
  { key: "advanced", icon: "code", label: "高级" },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];

export function SettingsPage() {
  const settings = useSettings();
  const save = useSaveSettings();
  const [memory, setMemory] = useState<number>(2048);
  const [concurrency, setConcurrency] = useState<number>(8);
  const [jvmArgsText, setJvmArgsText] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!settings.data) return;
    setMemory(settings.data.defaultMemoryMaxMb ?? 2048);
    setConcurrency(settings.data.downloadConcurrency ?? 8);
    setJvmArgsText((settings.data.extraJvmArgs ?? []).join("\n"));
    setDirty(false);
  }, [settings.data]);

  const markDirty = (): void => setDirty(true);

  const saveAll = (): void => {
    save.mutate(
      {
        defaultMemoryMaxMb: memory,
        downloadConcurrency: concurrency,
        extraJvmArgs: jvmArgsText.split("\n").map((s) => s.trim()).filter(Boolean),
      },
      {
        onSuccess: () => {
          toast.success("设置已保存");
          setDirty(false);
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : "保存失败"),
      },
    );
  };

  return (
    <Box sx={{ p: 3, maxWidth: 1080, mx: "auto", pb: dirty ? 10 : 3 }}>
      <PageHeader title="设置" description={`启动器版本 v${APP_VERSION}`} />

      <Box sx={{ display: "flex", gap: 3, alignItems: "flex-start" }}>
        <Card
          sx={{
            width: 168,
            flexShrink: 0,
            position: "sticky",
            top: 24,
            p: 1,
            bgcolor: "surfaceContainerLow",
          }}
        >
          <List dense disablePadding>
            {SECTIONS.map((s) => (
              <ListItemButton
                key={s.key}
                onClick={() => document.getElementById(`sec-${s.key}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                sx={{ borderRadius: 2 }}
              >
                <ListItemIcon sx={{ minWidth: 32 }}>
                  <AppIcon name={s.icon} size={19} />
                </ListItemIcon>
                <Typography variant="body2">{s.label}</Typography>
              </ListItemButton>
            ))}
          </List>
        </Card>

        <Stack spacing={2} sx={{ flex: 1, minWidth: 0 }}>
          <Section id="sec-general" icon="settings" title="常规">
            <FormRow label="默认最大内存" description="新建实例时的默认内存分配">
              <Box sx={{ pr: 3 }}>
                <Slider
                  value={memory}
                  onChange={(_e, v) => {
                    setMemory(Array.isArray(v) ? v[0] ?? memory : v);
                    markDirty();
                  }}
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
              </Box>
            </FormRow>
          </Section>

          <AppearanceSection />

          <JavaSection />

          <Section id="sec-downloads" icon="download" title="下载">
            <FormRow label="并发下载数" description={`${concurrency} 个并行连接`}>
              <Box sx={{ pr: 3 }}>
                <Slider
                  value={concurrency}
                  onChange={(_e, v) => {
                    setConcurrency(Array.isArray(v) ? v[0] ?? concurrency : v);
                    markDirty();
                  }}
                  min={1}
                  max={16}
                  step={1}
                  marks
                  valueLabelDisplay="auto"
                />
              </Box>
            </FormRow>
          </Section>

          <Section id="sec-advanced" icon="code" title="高级">
            <FormRow label="全局 JVM 参数" description="附加到所有实例，每行一条">
              <TextField
                size="small"
                multiline
                rows={4}
                fullWidth
                value={jvmArgsText}
                onChange={(e) => {
                  setJvmArgsText(e.target.value);
                  markDirty();
                }}
                placeholder={"-XX:+UseG1GC"}
              />
            </FormRow>
          </Section>
        </Stack>
      </Box>

      {dirty && (
        <Box
          sx={{
            position: "fixed",
            bottom: 44,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: (t) => t.zIndex.appBar,
            bgcolor: "surfaceContainerHighest",
            borderRadius: 1000,
            px: 2,
            py: 1,
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            boxShadow: 3,
          }}
        >
          <Typography variant="caption">有未保存的更改</Typography>
          <Button size="small" onClick={() => settings.refetch()}>
            放弃
          </Button>
          <Button size="small" variant="contained" disabled={save.isPending} onClick={saveAll}>
            {save.isPending ? "保存中…" : "保存"}
          </Button>
        </Box>
      )}
    </Box>
  );
}

function Section({ id, icon, title, children }: { id: string; icon: string; title: string; children: React.ReactNode }) {
  return (
    <Card component="section" id={id} sx={{ p: 2.5, scrollMarginTop: 24 }} aria-label={title}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, mb: 0.5 }}>
        <AppIcon name={icon} size={20} />
        <Typography variant="h6">{title}</Typography>
      </Box>
      {children}
    </Card>
  );
}

function AppearanceSection() {
  const mode = uiStore((s) => s.mode);
  const setMode = uiStore((s) => s.setMode);
  const { setMode: applyMode } = useColorScheme();

  const options: Array<{ value: ThemeMode; icon: string; label: string }> = [
    { value: "system", icon: "brightness_auto", label: "跟随系统" },
    { value: "light", icon: "light_mode", label: "浅色" },
    { value: "dark", icon: "dark_mode", label: "深色" },
  ];

  return (
    <Section id="sec-appearance" icon="palette" title="外观">
      <FormRow label="主题模式" description="偏好保存在本机，立即生效">
        <Box sx={{ display: "flex", gap: 1 }}>
          {options.map((opt) => (
            <Button
              key={opt.value}
              size="small"
              variant={mode === opt.value ? "contained" : "outlined"}
              startIcon={<AppIcon name={opt.icon} size={17} filled={mode === opt.value} />}
              onClick={() => {
                setMode(opt.value);
                void applyMode(opt.value);
              }}
              aria-pressed={mode === opt.value}
            >
              {opt.label}
            </Button>
          ))}
        </Box>
      </FormRow>
    </Section>
  );
}

function JavaSection() {
  const java = useJavaRuntimes();
  const scan = useJavaScan();
  const runtimes = java.data ?? [];

  return (
    <Section id="sec-java" icon="coffee" title="Java 运行时">
      <Box sx={{ display: "flex", alignItems: "center", mb: 1.5 }}>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          检测到 {runtimes.length} 个运行时 · 启动时按 Minecraft 版本要求自动匹配
        </Typography>
        <Tooltip title="重新扫描系统中的 Java">
          <IconButton
            aria-label="扫描 Java"
            onClick={() =>
              scan.mutate(undefined, {
                onSuccess: (r) => toast.success(`扫描完成，发现 ${r.runtimes.length} 个 Java 运行时`),
                onError: () => toast.error("扫描失败"),
              })
            }
            disabled={scan.isPending}
            sx={{ ml: "auto" }}
          >
            {scan.isPending ? <CircularProgress size={18} /> : <AppIcon name="refresh" size={20} />}
          </IconButton>
        </Tooltip>
      </Box>

      {java.isLoading ? (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          正在读取已检测的运行时…
        </Typography>
      ) : runtimes.length === 0 ? (
        <Typography variant="body2" sx={{ color: "text.secondary", py: 1.5 }}>
          未检测到 Java。请安装 Java（如 Adoptium Temurin）后点击右上角刷新。
        </Typography>
      ) : (
        <Box sx={{ border: 1, borderColor: "divider", borderRadius: 2, overflowX: "hidden" }}>
          {runtimes.map((rt, idx) => (
            <Box
              key={rt.path}
              sx={{
                display: "grid",
                gridTemplateColumns: "64px 90px 70px 1fr auto",
                alignItems: "center",
                gap: 1.5,
                px: 1.75,
                py: 1,
                borderBottom: idx < runtimes.length - 1 ? 1 : 0,
                borderColor: "divider",
                typography: "caption",
              }}
            >
              <Chip size="small" color="primary" variant="outlined" label={`Java ${rt.majorVersion}`} />
              <span>{rt.architecture}</span>
              <Chip size="small" variant="outlined" label={rt.source === "system" ? "系统" : rt.source === "managed" ? "托管" : "手动"} sx={{ justifySelf: "start" }} />
              <Tooltip title={rt.path}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "rtl", textAlign: "left", color: "text.secondary" }}>
                  {rt.path}
                </span>
              </Tooltip>
              <span style={{ color: "text.disabled" }}>{rt.vendor ?? ""}</span>
            </Box>
          ))}
        </Box>
      )}
    </Section>
  );
}
