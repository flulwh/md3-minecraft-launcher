import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Typography from "@mui/material/Typography";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useImportInstance } from "../hooks/queries";
import { toast } from "../stores/toastStore";

export function ImportInstanceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const importMut = useImportInstance();
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<string>("");

  const pick = (): void => inputRef.current?.click();

  const onFile = (file: File | undefined): void => {
    if (!file) return;
    setSelected(file.name);
    importMut.mutate(file, {
      onSuccess: (r) => {
        toast.success(`已导入「${r.instance.name}」（${r.fileCount} 个文件）`);
        setSelected("");
        onClose();
        if (r.pendingInstall) {
          // mrpack 只带来 overrides，需要后续安装基础游戏。
          navigate(`/instances/${r.instance.id}`);
          toast.info("该整合包需要继续安装基础游戏");
        } else {
          navigate(`/instances/${r.instance.id}`);
        }
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : "导入失败"),
    });
  };

  return (
    <Dialog open={open} onClose={importMut.isPending ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>导入实例</DialogTitle>
      <DialogContent sx={{ pb: 1 }}>
        <Typography variant="body2" sx={{ color: "text.secondary", mb: 2 }}>
          支持 MD3 实例包（.zip）与 Modrinth 整合包（.mrpack）。导入将创建一个全新实例。
        </Typography>
        <input
          ref={inputRef}
          type="file"
          accept=".zip,.mrpack,application/zip,application/x-zip-compressed"
          hidden
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <Box
          role="button"
          tabIndex={0}
          onClick={importMut.isPending ? undefined : pick}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !importMut.isPending) pick();
          }}
          sx={{
            p: 3,
            borderRadius: 2,
            border: 1,
            borderColor: "outline",
            borderStyle: "dashed",
            textAlign: "center",
            cursor: importMut.isPending ? "default" : "pointer",
            "&:hover": importMut.isPending ? {} : { bgcolor: "surfaceContainerLow" },
          }}
        >
          <Typography variant="body2" sx={{ color: importMut.isPending ? "text.disabled" : "text.primary" }}>
            {selected ? selected : "点击选择 .zip 或 .mrpack 文件"}
          </Typography>
          {importMut.isPending && (
            <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mt: 0.5 }}>
              正在导入…
            </Typography>
          )}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={importMut.isPending}>
          取消
        </Button>
      </DialogActions>
    </Dialog>
  );
}