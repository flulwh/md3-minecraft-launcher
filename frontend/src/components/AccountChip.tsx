import Chip from "@mui/material/Chip";
import ListItemIcon from "@mui/material/ListItemIcon";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PublicAccount } from "../api/types";
import { AppIcon } from "../design-system/AppIcon";
import { useAccounts, useUpdateInstance } from "../hooks/queries";
import { resolveAccount } from "../lib/actions";
import { toast } from "../stores/toastStore";
import { uiStore } from "../stores/uiStore";

/**
 * Shows which account the given instance will launch with and lets the user
 * switch it in place (UX #3). Selecting an account pins it to the instance
 * (`preferredAccountId`) and makes it the global current account; "跟随全局账户"
 * unpins so the instance follows the global default.
 */
export function AccountChip({ instanceId }: { instanceId: string }) {
  const navigate = useNavigate();
  const { data: accounts } = useAccounts();
  const update = useUpdateInstance(instanceId);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const account = resolveAccount(instanceId);
  const open = Boolean(anchor);

  const selectAccount = (id: string | null): void => {
    setAnchor(null);
    if (id === null) {
      update.mutate({ preferredAccountId: null });
      toast.info("该实例将跟随全局当前账户");
      return;
    }
    const name = accounts?.find((a) => a.id === id)?.username ?? "";
    uiStore.getState().setCurrentAccount(id);
    update.mutate({ preferredAccountId: id });
    toast.success(`启动账户已切换为「${name}」`);
  };

  return (
    <>
      <Chip
        size="small"
        variant="outlined"
        icon={<AppIcon name="account_circle" size={14} />}
        label={account?.username ?? "未选择账户"}
        title={account ? `启动账户：${account.username}（点击切换）` : "未选择账户，点击添加"}
        onClick={(e) => {
          e.stopPropagation();
          if (!accounts || accounts.length === 0) {
            navigate("/accounts");
            return;
          }
          setAnchor(e.currentTarget);
        }}
        sx={{ cursor: "pointer", "& .MuiChip-icon": { fontSize: 14 } }}
      />
      <Menu anchorEl={anchor} open={open} onClose={() => setAnchor(null)}>
        {(accounts ?? []).map((a: PublicAccount) => (
          <MenuItem
            key={a.id}
            selected={account?.id === a.id}
            onClick={() => selectAccount(a.id)}
          >
            <ListItemIcon>
              <AppIcon name="account_circle" size={18} />
            </ListItemIcon>
            <Typography variant="body2">{a.username}</Typography>
          </MenuItem>
        ))}
        {accounts && accounts.length > 0 && (
          <MenuItem onClick={() => selectAccount(null)}>
            <ListItemIcon>
              <AppIcon name="sync" size={18} />
            </ListItemIcon>
            <Typography variant="body2">跟随全局账户</Typography>
          </MenuItem>
        )}
      </Menu>
    </>
  );
}
