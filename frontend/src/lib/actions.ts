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

/**
 * Resolves the account that will be used to launch `instanceId`.
 * Priority: the instance's pinned `preferredAccountId` → the global current
 * account → the first online (yggdrasil) account → the first account.
 */
export function resolveAccount(instanceId?: string): PublicAccount | null {
  const d = getDeps();
  if (!d) return null;
  const accounts = d.qc.getQueryData<PublicAccount[]>(qk.accounts);
  if (!accounts || accounts.length === 0) return null;
  if (instanceId) {
    const instances = d.qc.getQueryData<{ id: string; preferredAccountId: string | null }[]>(qk.instances);
    const pinned = instances?.find((i) => i.id === instanceId)?.preferredAccountId;
    if (pinned) {
      const pinnedAccount = accounts.find((a) => a.id === pinned);
      if (pinnedAccount) return pinnedAccount;
    }
  }
  const preferred = uiStore.getState().currentAccountId;
  return (
    accounts.find((a) => a.id === preferred) ??
    accounts.find((a) => a.type === "yggdrasil") ??
    accounts[0] ??
    null
  );
}

export async function startLaunch(instanceId: string): Promise<boolean> {
  const account = resolveAccount(instanceId);
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

/** When a graceful stop was requested per instance (for the "停止中…" countdown). */
const stopStartTimes = new Map<string, number>();

export function stopSession(instanceId: string): Promise<void> {
  const s = launchStore.getState().get(instanceId);
  if (!s.sessionId || !["running", "launching"].includes(s.phase)) return Promise.resolve();
  stopStartTimes.set(instanceId, Date.now());
  launchStore.getState().patch(instanceId, { phase: "stopping" });
  return launchApi
    .stop(s.sessionId)
    .then(() => undefined)
    .catch(() => {
      stopStartTimes.delete(instanceId);
      const cur = launchStore.getState().get(instanceId);
      if (cur.phase === "stopping") launchStore.getState().patch(instanceId, { phase: "running" });
    });
}

/** Milliseconds elapsed since the user requested a graceful stop (0 if none). */
export function stopElapsedMs(instanceId: string): number {
  const t = stopStartTimes.get(instanceId);
  return t === undefined ? 0 : Date.now() - t;
}

/** Force-terminates the process immediately instead of waiting for graceful exit. */
export async function forceStopSession(instanceId: string): Promise<void> {
  const s = launchStore.getState().get(instanceId);
  if (!s.sessionId) return;
  stopStartTimes.delete(instanceId);
  try {
    await launchApi.kill(s.sessionId);
    launchStore.getState().patch(instanceId, { phase: "stopping" });
  } catch {
    const cur = launchStore.getState().get(instanceId);
    if (cur.phase === "stopping") launchStore.getState().patch(instanceId, { phase: "running" });
  }
}

export async function previewLaunch(instanceId: string): Promise<void> {
  const account = resolveAccount(instanceId);
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
