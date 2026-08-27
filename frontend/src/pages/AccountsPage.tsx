import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import { useState } from "react";
import type { PublicAccount } from "../api/types";
import { AccountCard } from "../components/AccountCard";
import { LittleSkinDialog } from "../components/LittleSkinDialog";
import { OfflineAccountDialog } from "../components/OfflineAccountDialog";
import { AppIcon } from "../design-system/AppIcon";
import { ConfirmDialog } from "../design-system/ConfirmDialog";
import { PageHeader } from "../design-system/PageHeader";
import { StateView } from "../design-system/StateView";
import { useAccounts, useDeleteAccount } from "../hooks/queries";
import { uiStore } from "../stores/uiStore";

export function AccountsPage() {
  const accounts = useAccounts();
  const deleteAccount = useDeleteAccount();
  const [littleSkinOpen, setLittleSkinOpen] = useState(false);
  const [offlineOpen, setOfflineOpen] = useState(false);
  const [removing, setRemoving] = useState<PublicAccount | null>(null);

  return (
    <Box sx={{ p: 3, maxWidth: 1000, mx: "auto" }}>
      <PageHeader
        title="账户"
        description="管理用于启动游戏的 Minecraft 账户"
        actions={
          <>
            <Button variant="outlined" startIcon={<AppIcon name="person_add" size={18} />} onClick={() => setOfflineOpen(true)}>
              添加离线账户
            </Button>
            <Button variant="contained" startIcon={<AppIcon name="login" size={18} />} onClick={() => setLittleSkinOpen(true)}>
              登录 LittleSkin 账户
            </Button>
          </>
        }
      />

      <StateView
        loading={accounts.isLoading}
        error={accounts.error}
        onRetry={() => void accounts.refetch()}
        empty={(accounts.data?.length ?? 0) === 0}
        emptyIcon="person_off"
        emptyTitle="还没有账户"
        emptyDescription="登录 LittleSkin 账户以使用皮肤与在线鉴权，或创建离线账户快速体验"
        emptyAction={
          <Button variant="contained" startIcon={<AppIcon name="login" size={18} />} onClick={() => setLittleSkinOpen(true)}>
            登录 LittleSkin 账户
          </Button>
        }
      >
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 1.5 }}>
          {(accounts.data ?? []).map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              onSwitch={() => uiStore.getState().setCurrentAccount(account.id)}
              onRemove={() => setRemoving(account)}
            />
          ))}
        </Box>
      </StateView>

      <LittleSkinDialog open={littleSkinOpen} onClose={() => setLittleSkinOpen(false)} />
      <OfflineAccountDialog open={offlineOpen} onClose={() => setOfflineOpen(false)} />

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={`移除账户「${removing?.username ?? ""}」？`}
        danger
        confirmText="移除"
        loading={deleteAccount.isPending}
        message={
          removing?.type === "yggdrasil"
            ? "将清除本机保存的外部登录凭据；下次使用需要重新登录。"
            : "将从启动器中删除该离线账户。"
        }
        onConfirm={() =>
          removing &&
          deleteAccount.mutate(removing.id, {
            onSuccess: () => {
              if (uiStore.getState().currentAccountId === removing.id) {
                uiStore.getState().setCurrentAccount(null);
              }
              setRemoving(null);
            },
          })
        }
      />
    </Box>
  );
}
