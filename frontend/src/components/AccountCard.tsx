import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import type { PublicAccount } from "../api/types";
import { uiStore } from "../stores/uiStore";

export function AccountCard({
  account,
  onRemove,
  onSwitch,
}: {
  account: PublicAccount;
  onRemove: () => void;
  onSwitch: () => void;
}) {
  const currentId = uiStore((s) => s.currentAccountId);
  const isCurrent = currentId === account.id;
  const isYggdrasil = account.type === "yggdrasil";

  return (
    <Card
      sx={{
        p: 2,
        display: "flex",
        flexDirection: "column",
        gap: 1.25,
        ...(isCurrent && { borderColor: "primary.main" }),
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
        <Avatar
          sx={{ bgcolor: isYggdrasil ? "tertiary.container" : "secondary.container", color: isYggdrasil ? "tertiary.onContainer" : "secondary.onContainer", fontWeight: 600 }}
        >
          {account.username.slice(0, 2).toUpperCase()}
        </Avatar>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="subtitle1" noWrap sx={{ fontWeight: 600 }}>
            {account.username}
          </Typography>
          <Typography variant="caption" sx={{ color: "text.secondary", fontFamily: "monospace" }} noWrap>
            {account.profiles[0]?.id ?? account.id}
          </Typography>
        </Box>
        {isCurrent && <Chip size="small" color="primary" label="当前账户" />}
      </Box>

      <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
        <Chip
          size="small"
          variant="outlined"
          sx={isYggdrasil ? { color: "tertiary.main", borderColor: "tertiary.main" } : undefined}
          label={isYggdrasil ? "LittleSkin 账户" : "离线账户"}
        />
        {isYggdrasil && (
          <Chip
            size="small"
            variant="outlined"
            color={account.hasStoredCredentials ? "success" : "warning"}
            label={account.hasStoredCredentials ? "凭据已保存" : "无保存凭据"}
          />
        )}
      </Box>

      <Box sx={{ display: "flex", gap: 1, mt: "auto" }}>
        {!isCurrent && (
          <Button size="small" onClick={onSwitch}>
            设为当前
          </Button>
        )}
        <Button size="small" color="error" onClick={onRemove} sx={{ ml: "auto" }}>
          移除
        </Button>
      </Box>
    </Card>
  );
}
