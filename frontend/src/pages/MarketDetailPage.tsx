import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { MarketVersion } from "../api/types";
import { AppIcon } from "../design-system/AppIcon";
import { SectionHeader } from "../design-system/PageHeader";
import { StateView } from "../design-system/StateView";
import {
  useInstances,
  useMarketInstall,
  useMarketInstalled,
  useMarketItem,
  useMarketVersions,
} from "../hooks/queries";
import { fmtBytes, fmtDateTime, loaderLabel } from "../lib/format";
import { marketStore } from "../stores/marketStore";
import { toast } from "../stores/toastStore";

const TYPE_LABELS: Record<string, string> = {
  mod: "Mod",
  modpack: "整合包",
  resourcepack: "资源包",
  shader: "光影",
  world: "存档",
};

function VersionRow({
  v,
  onInstall,
  installing,
  installed,
}: {
  v: MarketVersion;
  onInstall: (v: MarketVersion) => void;
  installing: boolean;
  installed: boolean;
}) {
  return (
    <Box sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 0.75 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {v.versionName}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {fmtBytes(v.fileSize)}
        </Typography>
        <Button
          size="small"
          variant={installed ? "outlined" : "contained"}
          color={installed ? "success" : "primary"}
          disabled={installing || installed}
          startIcon={
            installing ? (
              <CircularProgress size={14} color="inherit" />
            ) : (
              <AppIcon name={installed ? "check_circle" : "download"} size={16} />
            )
          }
          onClick={() => onInstall(v)}
        >
          {installing ? "安装中…" : installed ? "已安装" : "安装"}
        </Button>
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" }}>
        {v.minecraftVersions.map((mc) => (
          <Chip key={mc} size="small" label={`MC ${mc}`} sx={{ height: 20, fontSize: 11 }} />
        ))}
        {v.loader && (
          <Chip size="small" label={loaderLabel(v.loader)} sx={{ height: 20, fontSize: 11 }} />
        )}
      </Box>
      <Box
        sx={{
          typography: "caption",
          color: "text.secondary",
          display: "flex",
          alignItems: "center",
          gap: 1,
        }}
      >
        <Typography component="span" noWrap sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
          {v.fileName}
        </Typography>
        {v.releaseDate && (
          <Box component="span" sx={{ ml: "auto" }}>
            {fmtDateTime(v.releaseDate)}
          </Box>
        )}
      </Box>
    </Box>
  );
}

export function MarketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const store = marketStore();
  const { data: instances } = useInstances();
  const { data: item, isLoading, error, refetch } = useMarketItem(id);
  const {
    data: versions,
    isLoading: versionsLoading,
    error: versionsError,
    refetch: refetchVersions,
  } = useMarketVersions(id);

  const installMutation = useMarketInstall();
  const { data: installed } = useMarketInstalled(store.instanceId ?? undefined);
  const adapterInstance = instances?.find((i) => i.id === store.instanceId);

  const [showAll, setShowAll] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState<MarketVersion | null>(null);

  // Derive the effective version/loader for filtering, mirroring the market bar.
  const isLoaderDriven = item?.type === "mod" || item?.type === "modpack";
  const mcVersion =
    store.clearVersion
      ? store.version || undefined
      : store.version || adapterInstance?.minecraftVersion || undefined;
  const loader =
    (store.loader !== "" ? store.loader : isLoaderDriven && adapterInstance && adapterInstance.loader !== "vanilla"
      ? adapterInstance.loader
      : "") || undefined;

  let compatible = versions ?? [];
  if (!showAll) {
    if (mcVersion) compatible = compatible.filter((v) => v.minecraftVersions.includes(mcVersion));
    if (loader) {
      const withLoader = compatible.filter((v) => v.loader === loader);
      if (withLoader.length > 0) compatible = withLoader; // keep version filter authoritative
    }
  }
  const hidingSome = !showAll && versionCount(versions ?? []) !== compatible.length;

  const installedNames = new Set(
    (installed ?? []).filter((e) => e.provider === "modrinth").map((e) => e.versionName),
  );

  const runInstall = (v: MarketVersion, instanceId: string, instanceName: string): void => {
    if (!id) return;
    setPending(v);
    installMutation.mutate(
      {
        instanceId,
        provider: "modrinth",
        projectId: id,
        versionId: v.id,
      },
      {
        onSuccess: () => {
          toast.success(`已安装到「${instanceName}」`);
          setPending(null);
        },
        onError: (err) => {
          const msg =
            err && typeof err === "object" && "code" in err
              ? friendlyError((err as { code: string; message: string }).code, (err as { message: string }).message)
              : err instanceof Error
                ? err.message
                : "安装失败";
          toast.error(msg);
          setPending(null);
        },
      },
    );
  };

  const onInstallClick = (v: MarketVersion): void => {
    if (!adapterInstance) {
      if (!instances || instances.length === 0) {
        toast.warning("请先创建一个实例");
        return;
      }
      setPending(v);
      setPickerOpen(true);
      return;
    }
    runInstall(v, adapterInstance.id, adapterInstance.name);
  };

  return (
    <Box component="section">
      <Button
        size="small"
        startIcon={<AppIcon name="arrow_back" size={18} />}
        onClick={() => navigate(-1)}
        sx={{ mb: 1 }}
      >
        返回市场
      </Button>

      <StateView loading={isLoading} error={error} onRetry={() => void refetch()}>
        {item && (
          <>
            <Card sx={{ p: 2.5, display: "flex", gap: 2 }}>
              {item.iconUrl ? (
                <Box
                  component="img"
                  src={item.iconUrl}
                  alt=""
                  loading="lazy"
                  sx={{
                    width: 72,
                    height: 72,
                    borderRadius: 2,
                    objectFit: "cover",
                    flexShrink: 0,
                  }}
                />
              ) : (
                <Box
                  sx={{
                    width: 72,
                    height: 72,
                    borderRadius: 2,
                    flexShrink: 0,
                    bgcolor: "surfaceContainerHigh",
                    color: "text.secondary",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <AppIcon name="extension" size={34} />
                </Box>
              )}
              <Box sx={{ minWidth: 0 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                  <Typography variant="h5" sx={{ fontWeight: 600 }}>
                    {item.name}
                  </Typography>
                  <Chip size="small" label={TYPE_LABELS[item.type] ?? item.type} />
                  {item.provider === "modrinth" && <Chip size="small" label="Modrinth" />}
                </Box>
                {item.author && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                    作者：{item.author}
                  </Typography>
                )}
                <Box
                  sx={{
                    typography: "caption",
                    color: "text.secondary",
                    mt: 0.5,
                    display: "flex",
                    alignItems: "center",
                    gap: 0.5,
                  }}
                >
                  <AppIcon name="download" size={14} />
                  {item.downloads.toLocaleString("zh-CN")} 次下载
                </Box>
              </Box>
            </Card>

            {item.description && (
              <Paper variant="outlined" sx={{ mt: 2, p: 2 }}>
                <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "pre-wrap" }}>
                  {item.description}
                </Typography>
              </Paper>
            )}

            {["modpack", "world"].includes(item.type) && (
              <Paper variant="outlined" sx={{ mt: 2, p: 2, bgcolor: "warning.container" }}>
                <Typography variant="body2">
                  该类型（{TYPE_LABELS[item.type] ?? item.type}）暂不支持直接安装到单个实例。
                </Typography>
              </Paper>
            )}

            <Divider sx={{ my: 2.5 }} />
            <SectionHeader
              title="可用版本"
              icon="inventory_2"
              trailing={
                <Typography variant="caption" sx={{ color: "text.disabled" }}>
                  {compatible.length} 个版本
                </Typography>
              }
            />

            {adapterInstance && !showAll && (mcVersion || loader) && (
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  flexWrap: "wrap",
                  mb: 1.5,
                  p: 1,
                  borderRadius: 1,
                  bgcolor: "surfaceContainerLow",
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  已按实例「{adapterInstance.name}」适配：
                </Typography>
                {mcVersion && <Chip size="small" color="primary" label={`MC ${mcVersion}`} />}
                {loader && <Chip size="small" color="primary" label={loaderLabel(loader)} />}
                <Box sx={{ flex: 1 }} />
                <Button size="small" onClick={() => setShowAll(true)}>
                  查看全部 {versionCount(versions ?? [])} 个版本
                </Button>
              </Box>
            )}
            {showAll && (
              <Box sx={{ mb: 1.5 }}>
                <Button size="small" onClick={() => setShowAll(false)}>
                  返回「已适配实例」版本
                </Button>
              </Box>
            )}

            <StateView
              loading={versionsLoading}
              error={versionsError}
              onRetry={() => void refetchVersions()}
              empty={compatible.length === 0}
              emptyTitle={hidingSome ? "没有适配该实例的版本" : "暂无可用版本"}
              emptyDescription={hidingSome ? "可点击右上角查看全部版本" : undefined}
            >
              <Card variant="outlined" sx={{ overflow: "hidden" }}>
                {compatible.map((v, i) => (
                  <Box key={v.id}>
                    {i > 0 && <Divider />}
                    <VersionRow
                      v={v}
                      installing={installMutation.isPending && pending?.id === v.id}
                      installed={installedNames.has(v.versionName)}
                      onInstall={onInstallClick}
                    />
                  </Box>
                ))}
              </Card>
            </StateView>
          </>
        )}
      </StateView>

      <Dialog open={pickerOpen} onClose={() => setPickerOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>选择要安装到的实例</DialogTitle>
        <DialogContent dividers sx={{ p: 0 }}>
          <List dense sx={{ maxHeight: 320, overflow: "auto" }}>
            {(instances ?? []).map((inst) => (
              <ListItemButton key={inst.id} onClick={() => runInstall(pending!, inst.id, inst.name)}>
                <Box sx={{ mr: 1.5, display: "flex" }}>
                  <AppIcon name="widgets" size={18} />
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" noWrap>
                    {inst.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    MC {inst.minecraftVersion} · {loaderLabel(inst.loader)}
                  </Typography>
                </Box>
              </ListItemButton>
            ))}
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPickerOpen(false)} size="small">
            取消
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function versionCount(list: MarketVersion[]): number {
  return list.length;
}

function friendlyError(code: string, message: string): string {
  if (code === "VALIDATION_ERROR" || code === "Already_Installed") return "该文件已安装到此实例";
  if (message === "Already installed") return "该文件已安装到此实例";
  if (code === "DOWNLOAD_ERROR") return `下载失败：${message}`;
  return message || "安装失败";
}