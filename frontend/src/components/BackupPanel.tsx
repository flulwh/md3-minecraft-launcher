import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Typography from "@mui/material/Typography";
import type { MouseEvent } from "react";
import { useState } from "react";
import type { InstanceBackup } from "../api/types";
import { AppIcon } from "../design-system/AppIcon";
import { ConfirmDialog } from "../design-system/ConfirmDialog";
import { useBackups, useCreateBackup, useDeleteBackup, useRestoreBackup } from "../hooks/queries";
import { fmtBytes, fmtDateTime } from "../lib/format";
import { toast } from "../stores/toastStore";

const KIND_LABELS: Record<string, string> = {
  manual: "手动",
  prelaunch: "启动前",
  postlaunch: "关闭后",
  auto: "自动",
  beforeDelete: "删除前",
};

export function BackupPanel({ instanceId, scrollKey }: { instanceId: string; scrollKey: string }) {
  const create = useCreateBackup(instanceId);
  const restore = useRestoreBackup(instanceId);
  const remove = useDeleteBackup(instanceId);
  return (
    <Card id={scrollKey} sx={{ p: 2.5, scrollMarginTop: 10 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, pb: 1 }}>
        <AppIcon name="backup" size={22} />
        <Typography variant="subtitle1" sx={{ flex: 1, fontWeight: 600 }}>
          备份与还原
        </Typography>
        <Button
          size="small"
          variant="contained"
          startIcon={<AppIcon name="add" filled size={16} />}
          onClick={() =>
            create.mutate(undefined, {
              onSuccess: (b) => toast.success(`备份完成：${b.label ?? b.fileName}`),
              onError: (err) => toast.error(err instanceof Error ? err.message : "备份失败"),
            })
          }
          disabled={create.isPending}
        >
          {create.isPending ? "备份中…" : "创建备份"}
        </Button>
      </Box>
      <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 1.5 }}>
        备份为自包含压缩包，包含存档、配置与 Mod；删除实例后备份仍会保留，可用于还原。
      </Typography>
      <BackupRows
        instanceId={instanceId}
        restore={restore}
        remove={remove}
      />
    </Card>
  );
}

function BackupRows({
  instanceId,
  restore,
  remove,
}: {
  instanceId: string;
  restore: ReturnType<typeof useRestoreBackup>;
  remove: ReturnType<typeof useDeleteBackup>;
}) {
  const backups = useBackups(instanceId);
  const list = backups.data ?? [];
  const [anchor, setAnchor] = useState<{ el: HTMLElement; backup: InstanceBackup } | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<InstanceBackup | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InstanceBackup | null>(null);

  if (backups.isLoading) {
    return <Typography variant="caption" sx={{ color: "text.secondary" }}>读取中…</Typography>;
  }
  if (list.length === 0) {
    return (
      <Box sx={{ py: 2.5, textAlign: "center", borderRadius: 2, bgcolor: "surfaceContainerLow" }}>
        <AppIcon name="backup_table" size={30} />
        <Typography variant="body2" sx={{ color: "text.secondary", mt: 1 }}>
          还没有备份。点击右上角「创建备份」可保存当前状态。
        </Typography>
      </Box>
    );
  }

  const openMenu = (e: MouseEvent<HTMLElement>, b: InstanceBackup): void => {
    setAnchor({ el: e.currentTarget, backup: b });
  };

  return (
    <>
      <Box sx={{ display: "grid", gap: 0.75 }}>
        {list.map((b) => (
          <Box
            key={b.id}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1.5,
              px: 1.5,
              py: 1,
              borderRadius: 1.5,
              bgcolor: "surfaceContainerLow",
            }}
          >
            <AppIcon name="archive" size={18} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                {b.label ?? b.fileName}
              </Typography>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {fmtDateTime(b.createdAt)} · {KIND_LABELS[b.kind] ?? b.kind} · {fmtBytes(b.sizeBytes)} · {b.fileCount} 个文件
              </Typography>
            </Box>
            <IconButton size="small" aria-label="备份操作" onClick={(e) => openMenu(e, b)}>
              <AppIcon name="more_vert" size={18} />
            </IconButton>
          </Box>
        ))}
      </Box>

      <Menu
        anchorEl={anchor?.el ?? null}
        open={anchor !== null}
        onClose={() => setAnchor(null)}
      >
        <MenuItem
          onClick={() => {
            if (anchor) setRestoreTarget(anchor.backup);
            setAnchor(null);
          }}
        >
          <ListItemIcon><AppIcon name="restore" size={18} /></ListItemIcon>
          还原到此备份
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (anchor) setDeleteTarget(anchor.backup);
            setAnchor(null);
          }}
          sx={{ color: "error.main" }}
        >
          <ListItemIcon><AppIcon name="delete" size={18} /></ListItemIcon>
          删除备份
        </MenuItem>
      </Menu>

      <ConfirmDialog
        open={restoreTarget !== null}
        onClose={() => setRestoreTarget(null)}
        title="从备份还原？"
        danger
        confirmText="还原"
        loading={restore.isPending}
        message={
          restoreTarget
            ? `将用备份「${restoreTarget.label ?? restoreTarget.fileName}」覆盖当前游戏目录中的文件，现有更改可能丢失。建议先创建一个新备份。`
            : undefined
        }
        onConfirm={() =>
          restoreTarget &&
          restore.mutate(restoreTarget.id, {
            onSuccess: (r) => {
              setRestoreTarget(null);
              toast.success(`还原完成（${r.fileCount} 个文件）`);
            },
            onError: (err) => toast.error(err instanceof Error ? err.message : "还原失败"),
          })
        }
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="删除此备份？"
        danger
        confirmText="删除"
        loading={remove.isPending}
        message={deleteTarget ? `将删除备份「${deleteTarget.label ?? deleteTarget.fileName}」，此操作不可恢复。` : undefined}
        onConfirm={() =>
          deleteTarget &&
          remove.mutate(deleteTarget.id, {
            onSuccess: () => {
              setDeleteTarget(null);
              toast.success("备份已删除");
            },
            onError: (err) => toast.error(err instanceof Error ? err.message : "删除失败"),
          })
        }
      />
    </>
  );
}