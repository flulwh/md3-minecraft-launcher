import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { InstanceDto } from "../api/types";
import { AppIcon } from "../design-system/AppIcon";
import { ConfirmDialog } from "../design-system/ConfirmDialog";
import { LoaderChip } from "../design-system/LoaderChip";
import { AccountChip } from "./AccountChip";
import { useDeleteInstance, useDeleteSummary, useDuplicateInstance, useExportInstance, useUpdateInstance } from "../hooks/queries";
import { previewLaunch, startLaunch, stopSession } from "../lib/actions";
import { fmtBytes, fmtRelative, loaderLabel } from "../lib/format";
import { launchStore } from "../stores/launchStore";
import { logStore } from "../stores/logStore";
import { toast } from "../stores/toastStore";

export interface InstanceCardProps {
  instance: InstanceDto;
  lastPlayedAt?: string | null;
  onEdit?: (instance: InstanceDto) => void;
}

export function InstanceCard({ instance, lastPlayedAt, onEdit }: InstanceCardProps) {
  const navigate = useNavigate();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const deleteInstance = useDeleteInstance();
  const duplicate = useDuplicateInstance();
  const exportInstance = useExportInstance();
  const updateInstance = useUpdateInstance(instance.id);
  const predelete = useDeleteSummary(confirmDelete ? instance.id : undefined);
  const phase = launchStore((s) => s.byInstance[instance.id]?.phase ?? "idle");
  const runningLike = ["running", "launching"].includes(phase);

  const openGameDir = (): void => {
    void window.launcher?.revealItem(instance.gameDir);
  };

  return (
    <>
      <Card
        onClick={() => navigate(`/instances/${instance.id}`)}
        sx={{
          p: 2,
          display: "flex",
          flexDirection: "column",
          gap: 1.25,
          cursor: "pointer",
          transition: (t) => t.transitions.create(["background-color", "border-color"]),
          "&:hover": {
            bgcolor: "surfaceContainerHigh",
            borderColor: "outline",
          },
        }}
      >
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="subtitle1" noWrap title={instance.name} sx={{ fontWeight: 600 }}>
              {instance.name}
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }} component="div">
              Minecraft {instance.minecraftVersion}
              {instance.loaderVersion ? ` · ${loaderLabel(instance.loader)} ${instance.loaderVersion}` : ""}
            </Typography>
          </Box>
          <IconButton
            aria-label={instance.favorite ? "取消收藏" : "收藏"}
            onClick={(e) => {
              e.stopPropagation();
              updateInstance.mutate({ favorite: !instance.favorite });
            }}
            size="small"
            sx={{ flexShrink: 0, color: instance.favorite ? "warning.main" : "text.disabled" }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <AppIcon name="star" size={18} filled={instance.favorite} />
          </IconButton>
          <IconButton
            aria-label={`实例「${instance.name}」的更多操作`}
            onClick={(e) => {
              e.stopPropagation();
              setMenuAnchor(e.currentTarget);
            }}
            sx={{ flexShrink: 0 }}
          >
            <AppIcon name="more_vert" size={18} />
          </IconButton>
        </Box>

        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
          <LoaderChip loader={instance.loader} version={null} />
          <AccountChip instanceId={instance.id} />
          {instance.status === "BROKEN" && (
            <Chip
              size="small"
              color="error"
              icon={<AppIcon name="build" size={13} filled />}
              clickable
              label="需修复"
              title="点击进入修复入口"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/instances/${instance.id}?tab=settings`);
              }}
            />
          )}
          {instance.status === "CREATED" && (
            <Chip size="small" color="warning" label="未安装" />
          )}
          {instance.status === "INSTALLING" && (
            <Chip size="small" color="info" label="安装中" />
          )}
          {runningLike ? (
            <Chip
              size="small"
              color="success"
              icon={<AppIcon name="sports_esports" size={13} filled />}
              label={phase === "running" ? "运行中" : "启动中"}
            />
          ) : (
            phase === "crashed" && (
              <Chip size="small" color="error" label="上次异常退出" />
            )
          )}
        </Box>

        {instance.tags.length > 0 && (
          <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
            {instance.tags.map((t) => (
              <Chip
                key={t}
                size="small"
                variant="outlined"
                icon={<AppIcon name="label" size={12} />}
                label={t}
                sx={{ height: 20, fontSize: 11, "& .MuiChip-icon": { fontSize: 12 } }}
              />
            ))}
          </Box>
        )}

        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }} noWrap>
              内存 {fmtBytes((instance.memoryMaxMb ?? 0) * 1024 * 1024)} · {fmtRelative(lastPlayedAt)}
            </Typography>
          </Box>
          <Box sx={{ flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
            {runningLike || phase === "stopping" ? (
              <Box
                component="button"
                onClick={() => void stopSession(instance.id)}
                sx={{
                  border: "none",
                  cursor: "pointer",
                  borderRadius: 1000,
                  px: 1.5,
                  height: 32,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 0.5,
                  typography: "caption",
                  fontWeight: 600,
                  bgcolor: "transparent",
                  color: "error.main",
                  borderStyle: "solid",
                  borderWidth: 1,
                  borderColor: "error.main",
                }}
              >
                <AppIcon name="stop" filled size={14} />
                停止
              </Box>
            ) : (
              <Box
                component="button"
                onClick={() =>
                  phase === "crashed"
                    ? navigate(`/instances/${instance.id}`)
                    : void startLaunch(instance.id)
                }
                sx={{
                  border: "none",
                  cursor: "pointer",
                  borderRadius: 1000,
                  px: 1.75,
                  height: 32,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 0.5,
                  typography: "caption",
                  fontWeight: 600,
                  color: "primary.contrastText",
                  bgcolor: "primary.main",
                  "&:hover": { filter: "brightness(1.08)" },
                }}
              >
                <AppIcon name="play_arrow" filled size={15} />
                启动
              </Box>
            )}
          </Box>
        </Box>
      </Card>

      <Menu anchorEl={menuAnchor} open={menuAnchor !== null} onClose={() => setMenuAnchor(null)}>
        {!runningLike && (
          <MenuItem onClick={() => { setMenuAnchor(null); void startLaunch(instance.id); }}>
            <ListItemIcon><AppIcon name="play_arrow" size={18} /></ListItemIcon>
            启动游戏
          </MenuItem>
        )}
        {!runningLike && (
          <MenuItem onClick={() => { setMenuAnchor(null); void previewLaunch(instance.id); toast.info("预检已开始，结果将在实例详情中展示"); }}>
            <ListItemIcon><AppIcon name="fact_check" size={18} /></ListItemIcon>
            预检运行环境
          </MenuItem>
        )}
        <MenuItem onClick={() => { setMenuAnchor(null); updateInstance.mutate({ favorite: !instance.favorite }); }}>
          <ListItemIcon><AppIcon name="star" size={18} filled={instance.favorite} /></ListItemIcon>
          {instance.favorite ? "取消收藏" : "收藏"}
        </MenuItem>
        <MenuItem onClick={() => { setMenuAnchor(null); openGameDir(); }}>
          <ListItemIcon><AppIcon name="folder_open" size={18} /></ListItemIcon>
          打开游戏目录
        </MenuItem>
        <MenuItem
          disabled={runningLike}
          onClick={() => {
            setMenuAnchor(null);
            exportInstance.mutate(instance.id, {
              onSuccess: (r) => {
                toast.success(`已导出 ${r.fileName}`);
                void window.launcher?.revealItem(r.path);
              },
              onError: (err) => toast.error(err instanceof Error ? err.message : "导出失败"),
            });
          }}
        >
          <ListItemIcon><AppIcon name="archive" size={18} /></ListItemIcon>
          导出为压缩包
        </MenuItem>
        <MenuItem
          disabled={runningLike}
          onClick={() => {
            setMenuAnchor(null);
            navigate(`/instances/${instance.id}?tab=overview#backup`);
          }}
        >
          <ListItemIcon><AppIcon name="backup" size={18} /></ListItemIcon>
          备份与还原
        </MenuItem>
        <MenuItem
          disabled={runningLike}
          onClick={() => { setMenuAnchor(null); setConfirmDuplicate(true); }}
        >
          <ListItemIcon><AppIcon name="copy_all" size={18} /></ListItemIcon>
          复制实例
        </MenuItem>
        <MenuItem onClick={() => { setMenuAnchor(null); onEdit?.(instance); navigate(`/instances/${instance.id}?tab=settings`); }}>
          <ListItemIcon><AppIcon name="tune" size={18} /></ListItemIcon>
          编辑设置
        </MenuItem>
        <MenuItem
          onClick={() => { setMenuAnchor(null); setConfirmDelete(true); }}
          sx={{ color: "error.main" }}
        >
          <ListItemIcon><AppIcon name="delete" size={18} /></ListItemIcon>
          删除实例
        </MenuItem>
      </Menu>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`删除实例「${instance.name}」？`}
        danger
        confirmText="删除"
        loading={deleteInstance.isPending}
        message={
          <>
            <Typography variant="body2" sx={{ color: "error.main", fontWeight: 600, pb: 1 }}>
              将永久删除本地游戏文件（含存档、配置、Mod 与资源包），此操作无法撤销。
            </Typography>
            {predelete.data ? (
              <Box sx={{ display: "grid", gap: 0.5, pb: 1 }}>
                <DeleteStat label="占用的文件大小" value={fmtBytes(predelete.data.totalSizeBytes)} />
                <DeleteStat label="包含的世界" value={`${predelete.data.saves.count} 个`} />
                <DeleteStat label="本地备份" value={predelete.data.hasBackups ? `${predelete.data.backupCount} 份` : "无"} />
              </Box>
            ) : (
              <Typography variant="caption" sx={{ display: "block", pb: 1, color: "text.secondary" }}>
                正在统计文件大小…
              </Typography>
            )}
            {predelete.data && predelete.data.saves.count > 0 && (
              <Typography variant="caption" sx={{ display: "block", color: "warning.main", pb: 1 }}>
                {predelete.data.hasBackups
                  ? "如需保留，可先到「备份与还原」手动备份存档。"
                  : "建议先到「备份与还原」创建一个备份再删除。"}
              </Typography>
            )}
          </>
        }
        onConfirm={() =>
          deleteInstance.mutate(instance.id, {
            onSuccess: () => {
              logStore.getState().remove(instance.id);
              setConfirmDelete(false);
            },
          })
        }
      />

      <ConfirmDialog
        open={confirmDuplicate}
        onClose={() => setConfirmDuplicate(false)}
        title={`复制实例「${instance.name}」？`}
        confirmText="复制"
        loading={duplicate.isPending}
        message={
          <>
            将创建一份完整的副本（含存档、配置与 Mod），
            新实例名称为「{instance.name} - 副本」。库文件会被复用，不会重复下载。
          </>
        }
        onConfirm={() =>
          duplicate.mutate(
            { id: instance.id },
            {
              onSuccess: (dup) => {
                setConfirmDuplicate(false);
                toast.success(`已创建副本「${dup.name}」`);
              },
              onError: (err) => toast.error(err instanceof Error ? err.message : "复制失败"),
            },
          )
        }
      />
    </>
  );
}

function DeleteStat({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {value}
      </Typography>
    </Box>
  );
}
