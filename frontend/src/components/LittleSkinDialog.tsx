import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { useYggdrasilLogin } from "../hooks/queries";
import { toast } from "../stores/toastStore";

export function LittleSkinDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const login = useYggdrasilLogin();

  const valid = email.trim().length > 0 && password.length > 0;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>登录 LittleSkin 账户</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "12px !important" }}>
        <Typography variant="body2" color="text.secondary">
          使用你的 LittleSkin 邮箱与密码登录，启动器将自动获取你的游戏角色。
          若账号下有多个角色，可在 LittleSkin 先选定默认角色。
        </Typography>
        <TextField
          autoFocus
          fullWidth
          label="邮箱 / 用户名"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextField
          fullWidth
          label="密码"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && valid && !login.isPending) submit();
          }}
        />
        {login.isError && (
          <Alert severity="error">{login.error instanceof Error ? login.error.message : "登录失败"}</Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose}>取消</Button>
        <Button
          variant="contained"
          disabled={!valid || login.isPending}
          onClick={() => submit()}
        >
          {login.isPending ? "登录中…" : "登录"}
        </Button>
      </DialogActions>
    </Dialog>
  );

  function submit(): void {
    login.mutate(
      { username: email.trim(), password },
      {
        onSuccess: (account) => {
          toast.success(`已登录 ${account.username}`);
          setEmail("");
          setPassword("");
          onClose();
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : "登录失败"),
      },
    );
  }
}