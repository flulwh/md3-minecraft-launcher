import type { QueryClient } from "@tanstack/react-query";
import { launchApi } from "../api/launcherApi";
import type { PublicAccount } from "../api/types";
import { qk } from "../hooks/queries";
import { launchStore, markLaunchStart } from "../stores/launchStore";
import { toastStore } from "../stores/toastStore";
import { uiStore } from "../stores/uiStore";

interface ActionDeps {
  qc: QueryClient;
  navigate: (path: string) => void;
}

let deps: ActionDeps | null = null;

export function bindActions(d: ActionDeps): void {
  deps = d;
}

function getDeps(): ActionDeps | null {
  return deps;
}

export function resolveAccount(): PublicAccount | null {
  const d = getDeps();
  if (!d) return null;
  const accounts = d.qc.getQueryData<PublicAccount[]>(qk.accounts);
  if (!accounts || accounts.length === 0) return null;
  const preferred = uiStore.getState().currentAccountId;
  return (
    accounts.find((a) => a.id === preferred) ??
    accounts.find((a) => a.type === "yggdrasil") ??
    accounts[0] ??
    null
  );
}

export async function startLaunch(instanceId: string): Promise<boolean> {
  const account = resolveAccount();
  const d = getDeps();
  if (!account || !d) {
    toastStore.getState().push("请先添加一个账户再启动游戏", "warning");
    d?.navigate("/accounts");
    return false;
  }
  const s = launchStore.getState().get(instanceId);
  if (!["idle", "stopped", "crashed"].includes(s.phase)) return false;

  markLaunchStart();
  launchStore.getState().patch(instanceId, {
    phase: "preparing",
    error: null,
    crashReason: null,
    exitCode: null,
  });
  try {
    const res = await launchApi.launch({ instanceId, accountId: account.id });
    launchStore.getState().patch(instanceId, {
      sessionId: res.sessionId,
      pid: res.pid ?? null,
      lastPreflight: res.preflight.checks,
      phase: "launching",
    });
    if (!res.sessionId && res.preflight.success) {
      setTimeout(() => {
        const cur = launchStore.getState().get(instanceId);
        if (!cur.sessionId && ["launching", "preparing", "downloading"].includes(cur.phase)) {
          launchStore.getState().patch(instanceId, { phase: "stopped" });
        }
      }, 1500);
    }
    return true;
  } catch (err) {
    launchStore
      .getState()
      .patch(instanceId, { phase: "crashed", crashReason: err instanceof Error ? err.message : "启动失败" });
    return false;
  }
}

export async function stopSession(instanceId: string): Promise<void> {
  const s = launchStore.getState().get(instanceId);
  if (!s.sessionId || !["running", "launching"].includes(s.phase)) return;
  launchStore.getState().patch(instanceId, { phase: "stopping" });
  try {
    await launchApi.stop(s.sessionId);
  } catch {
    const cur = launchStore.getState().get(instanceId);
    if (cur.phase === "stopping") launchStore.getState().patch(instanceId, { phase: "running" });
  }
}

export async function previewLaunch(instanceId: string): Promise<void> {
  const account = resolveAccount();
  if (!account) {
    toastStore.getState().push("请先添加一个账户", "warning");
    getDeps()?.navigate("/accounts");
    return;
  }
  launchStore.getState().patch(instanceId, { phase: "checking" });
  try {
    const res = await launchApi.preview(instanceId, account.id);
    launchStore.getState().patch(instanceId, { lastPreflight: res.preflight.checks });
  } catch (err) {
    launchStore.getState().patch(instanceId, {
      lastPreflight: [
        { name: "预检", ok: false, detail: err instanceof Error ? err.message : "预检失败" },
      ],
    });
  } finally {
    const cur = launchStore.getState().get(instanceId);
    if (cur.phase === "checking") launchStore.getState().patch(instanceId, { phase: "idle" });
  }
}
