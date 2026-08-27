import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useNavigate } from "react-router-dom";
import { AppIcon } from "../design-system/AppIcon";
import { useAccounts, useHealth } from "../hooks/queries";
import { resolveAccount } from "../lib/actions";
import { downloadStore } from "../stores/downloadStore";
import { fmtSpeed } from "../lib/format";
import { API_BASE } from "../api/http";
import { STATUSBAR_HEIGHT } from "../theme/tokens";
import { uiStore } from "../stores/uiStore";
import { wsStore } from "../stores/wsStore";

export function StatusBar() {
  const health = useHealth();
  const accounts = useAccounts();
  const navigate = useNavigate();
  const connected = wsStore((s) => s.connected);
  const overrides = downloadStore((s) => s.overrides);
  const currentAccountId = uiStore((s) => s.currentAccountId);

  const active = Object.values(overrides).filter((t) => t.status === "downloading");
  const speed = active.reduce((sum, t) => sum + t.speedBps, 0);

  const account =
    accounts.data?.find((a) => a.id === currentAccountId) ??
    accounts.data?.find((a) => a.type === "yggdrasil") ??
    accounts.data?.[0] ??
    null;

  return (
    <Box
      component="footer"
      sx={{
        height: STATUSBAR_HEIGHT,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 2,
        px: 2,
        bgcolor: "surfaceContainerLow",
        borderTop: 1,
        borderColor: "divider",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
        <Box
          aria-label={connected ? "已连接" : "未连接"}
          sx={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            bgcolor: connected && health.isSuccess ? "success.main" : health.isError ? "error.main" : "text.disabled",
          }}
        />
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {API_BASE.replace(/^https?:\/\//, "")}
        </Typography>
      </Box>

      <Box sx={{ flex: 1 }} />

      {speed > 0 && (
        <Typography
          variant="caption"
          sx={{ display: "flex", alignItems: "center", gap: 0.5, color: "text.secondary", cursor: "pointer" }}
          onClick={() => navigate("/downloads")}
        >
          <AppIcon name="download" size={14} />
          {active.length} 个任务 · {fmtSpeed(speed)}
        </Typography>
      )}

      <Typography
        variant="caption"
        sx={{ display: "flex", alignItems: "center", gap: 0.75, cursor: "pointer", color: "text.secondary" }}
        onClick={() => navigate("/accounts")}
      >
        <AppIcon name="person" size={14} />
        {account?.username ?? "未选择账户"}
      </Typography>
    </Box>
  );
}
