import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { InstanceDto } from "../api/types";
import { AppIcon } from "../design-system/AppIcon";
import { ConfirmDialog } from "../design-system/ConfirmDialog";
import { LoaderChip } from "../design-system/LoaderChip";
import { useDeleteInstance } from "../hooks/queries";
import { previewLaunch, startLaunch, stopSession } from "../lib/actions";
import { fmtBytes, fmtRelative, loaderLabel } from "../lib/format";
import { launchStore } from "../stores/launchStore";
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
  const deleteInstance = useDeleteInstance();
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
        <MenuItem onClick={() => { setMenuAnchor(null); openGameDir(); }}>
          <ListItemIcon><AppIcon name="folder_open" size={18} /></ListItemIcon>
          打开游戏目录
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
            将从启动器中移除该实例（Minecraft {instance.minecraftVersion}）。
            <br />
            游戏目录中的存档与文件不会被删除：
            <Tooltip title={instance.gameDir}>
              <Typography variant="caption" sx={{ wordBreak: "break-all", display: "block", mt: 0.5 }}>
                {instance.gameDir}
              </Typography>
            </Tooltip>
          </>
        }
        onConfirm={() =>
          deleteInstance.mutate(instance.id, {
            onSuccess: () => setConfirmDelete(false),
          })
        }
      />
    </>
  );
}
