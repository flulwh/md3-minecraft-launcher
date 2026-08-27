import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import { useRef, useState } from "react";
import type { ContentKind } from "../api/types";
import { AppIcon } from "../design-system/AppIcon";
import { ConfirmDialog } from "../design-system/ConfirmDialog";
import { StateView } from "../design-system/StateView";
import {
  useContent,
  useContentDir,
  useRemoveContent,
  useToggleContent,
  useUploadContent,
} from "../hooks/queries";
import { fmtBytes } from "../lib/format";
import { toast } from "../stores/toastStore";

interface ContentListPanelProps {
  instanceId: string;
  kind: ContentKind;
  icon: string;
  title: string;
  subtitle: string;
  emptyHint: string;
  /** Accepted extensions for local import, e.g. ".jar,.zip". */
  accept?: string;
}

const ACCEPT: Record<ContentKind, string> = {
  mod: ".jar,application/java-archive,application/x-java-archive",
  resourcepack: ".zip,application/zip",
  shaderpack: ".zip,application/zip",
};

const EXT: Record<ContentKind, string> = {
  mod: ".jar",
  resourcepack: ".zip",
  shaderpack: ".zip",
};

/** Reusable list + enable/disable + delete panel for directory-scoped instance content. */
export function ContentListPanel({
  instanceId,
  kind,
  icon,
  title,
  subtitle,
  emptyHint,
  accept,
}: ContentListPanelProps) {
  const list = useContent(instanceId, kind);
  const dir = useContentDir(instanceId, kind);
  const toggle = useToggleContent(instanceId, kind);
  const remove = useRemoveContent(instanceId, kind);
  const upload = useUploadContent(instanceId, kind);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [pendingToggle, setPendingToggle] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const accepted = accept ?? ACCEPT[kind];
  const expectedExt = EXT[kind];
  const entries = list.data ?? [];

  const tryImport = (file: File | undefined): void => {
    if (!file) return;
    if (upload.isPending) return;
    upload.mutate(file, {
      onSuccess: (r) => toast.success(`已导入 ${r.imported}`),
      onError: (err) => toast.error(err instanceof Error ? err.message : "导入失败"),
    });
  };

  const confirmRemove = (fileName: string): void => {
    remove.mutate(fileName, {
      onSuccess: () => {
        setPendingDelete(null);
        toast.success(`已删除 ${fileName}`);
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : "删除失败"),
    });
  };

  return (
    <Card
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setDragOver(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        tryImport(e.dataTransfer.files?.[0]);
      }}
      sx={{ p: { xs: 2, md: 2.5 }, position: "relative" }}
    >
      {dragOver && (
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            zIndex: 5,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 2,
            bgcolor: "primary.container",
            color: "primary.onContainer",
            border: 2,
            borderStyle: "dashed",
            borderColor: "primary.main",
          }}
        >
          <Typography sx={{ fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 1 }}>
            <AppIcon name="upload_file" size={22} filled />
            释放以导入 {expectedExt}
          </Typography>
        </Box>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={accepted}
        hidden
        onChange={(e) => {
          tryImport(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5, mb: 2 }}>
        <AppIcon name={icon} size={26} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {title}
            <Chip size="small" sx={{ ml: 1 }} label={`${entries.length} 项`} variant="outlined" />
          </Typography>
          <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mt: 0.5 }}>
            {subtitle}
          </Typography>
        </Box>
        <Box sx={{ display: "flex", gap: 0.75, flexShrink: 0 }}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<AppIcon name="upload_file" size={16} />}
            disabled={upload.isPending}
            onClick={() => fileInputRef.current?.click()}
          >
            {upload.isPending ? "导入中…" : "导入"}
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<AppIcon name="folder_open" size={16} />}
            onClick={() => {
              if (dir.data) void window.launcher?.revealItem(dir.data.dir);
            }}
            disabled={!dir.data}
          >
            打开文件夹
          </Button>
        </Box>
      </Box>

      {list.isError ? (
        <StateView loading={false} error={list.error} onRetry={() => void list.refetch()}>
          <></>
        </StateView>
      ) : list.isLoading ? (
        <Stack spacing={1.5} sx={{ pt: 0.5 }}>
          {[0, 1, 2].map((i) => (
            <Box key={i} sx={{ height: 48, borderRadius: 1.5, bgcolor: "surfaceContainer" }} />
          ))}
        </Stack>
      ) : entries.length === 0 ? (
        <Box sx={{ py: 5, textAlign: "center", color: "text.secondary" }}>
          <AppIcon name={icon} size={40} />
          <Typography variant="body2" sx={{ mt: 1 }}>
            {emptyHint}
          </Typography>
        </Box>
      ) : (
        <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none" }}>
          {entries.map((entry, i) => {
            const toggling = pendingToggle === entry.fileName && toggle.isPending;
            const displayName = entry.fileName.replace(/\.jar?$|\.zip$|\.disabled$/gi, "");
            return (
              <Box key={entry.fileName} component="li" sx={{ py: 1.25 }}>
                {i > 0 && <Divider component="div" sx={{ mb: 1.25 }} />}
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
                  <AppIcon name={entry.enabled ? "check_circle" : "block"} size={20} filled={entry.enabled} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                      variant="body2"
                      sx={{ fontWeight: 500, color: entry.enabled ? "text.primary" : "text.secondary", wordBreak: "break-all" }}
                    >
                      {displayName || entry.fileName}
                    </Typography>
                    <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
                      {entry.size > 0 ? fmtBytes(entry.size) : "文件夹"}
                      {entry.enabled ? "" : " · 已停用"}
                    </Typography>
                  </Box>
                  <Switch
                    size="small"
                    checked={entry.enabled}
                    disabled={pendingToggle !== null && toggling}
                    onClick={() => setPendingToggle(entry.fileName)}
                    onChange={() =>
                      toggle.mutate(
                        { fileName: entry.fileName, enabled: !entry.enabled },
                        {
                          onSettled: () => setPendingToggle(null),
                          onError: (err) =>
                            toast.error(err instanceof Error ? err.message : "切换失败"),
                        },
                      )
                    }
                    slotProps={{ input: { "aria-label": `切换 ${entry.fileName}` } }}
                  />
                  <IconButton
                    size="small"
                    color="error"
                    aria-label={`删除 ${entry.fileName}`}
                    onClick={() => setPendingDelete(entry.fileName)}
                  >
                    <AppIcon name="delete" size={18} />
                  </IconButton>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title={`删除「${pendingDelete ?? ""}」？`}
        danger
        confirmText="删除"
        loading={remove.isPending}
        message="将从实例的游戏目录中移除该文件，此操作不可恢复。"
        onConfirm={() => pendingDelete && confirmRemove(pendingDelete)}
      />
    </Card>
  );
}