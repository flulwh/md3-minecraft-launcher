import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import TextField from "@mui/material/TextField";
import { useState } from "react";
import { useOfflineLogin } from "../hooks/queries";
import { toast } from "../stores/toastStore";

export function OfflineAccountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [username, setUsername] = useState("");
  const login = useOfflineLogin();

  const valid = username.trim().length >= 1 && username.trim().length <= 16;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>添加离线账户</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          label="用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          error={username.length > 0 && !valid}
          helperText="1–16 个字符，仅用于离线会话标识"
          slotProps={{ htmlInput: { maxLength: 16 } }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && valid && !login.isPending) submit();
          }}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose}>取消</Button>
        <Button
          variant="contained"
          disabled={!valid || login.isPending}
          onClick={() => submit()}
        >
          {login.isPending ? "创建中…" : "创建"}
        </Button>
      </DialogActions>
    </Dialog>
  );

  function submit(): void {
    login.mutate(username.trim(), {
      onSuccess: (account) => {
        toast.success(`已创建离线账户 ${account.username}`);
        setUsername("");
        onClose();
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : "创建失败"),
    });
  }
}
