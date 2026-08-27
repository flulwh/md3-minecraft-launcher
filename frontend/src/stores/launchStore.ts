import { create } from "zustand";
import type { LiveSession, PreflightCheck } from "../api/types";

export type LaunchPhase =
  | "idle"
  | "checking"
  | "preparing"
  | "downloading"
  | "launching"
  | "running"
  | "stopping"
  | "stopped"
  | "crashed";

export interface InstanceLaunchState {
  phase: LaunchPhase;
  sessionId: string | null;
  pid: number | null;
  exitCode: number | null;
  crashReason: string | null;
  error: string | null;
  lastPreflight: PreflightCheck[] | null;
}

const idleState = (): InstanceLaunchState => ({
  phase: "idle",
  sessionId: null,
  pid: null,
  exitCode: null,
  crashReason: null,
  error: null,
  lastPreflight: null,
});

interface LaunchStore {
  byInstance: Record<string, InstanceLaunchState>;
  get: (instanceId: string) => InstanceLaunchState;
  patch: (instanceId: string, partial: Partial<InstanceLaunchState>) => void;
  reset: (instanceId: string) => void;
  hydrate: (sessions: LiveSession[]) => void;
  onStarting: (instanceId: string, sessionId: string, pid: number | null) => void;
  onStarted: (instanceId: string, sessionId: string, pid: number | null) => void;
  onExit: (instanceId: string, sessionId: string, exitCode: number | null) => void;
  onCrash: (instanceId: string, sessionId: string, reason: string, exitCode?: number | null) => void;
  noteDownloadActivity: () => void;
}

let launchStartAt = 0;

export const launchStore = create<LaunchStore>((set, getState) => ({
  byInstance: {},
  get: (instanceId) => getState().byInstance[instanceId] ?? idleState(),
  patch: (instanceId, partial) =>
    set((state) => {
      const current = state.byInstance[instanceId] ?? idleState();
      return {
        byInstance: {
          ...state.byInstance,
          [instanceId]: { ...current, ...partial },
        },
      };
    }),
  reset: (instanceId) =>
    set((state) => ({
      byInstance: { ...state.byInstance, [instanceId]: idleState() },
    })),
  hydrate: (sessions) =>
    set((state) => {
      const next = { ...state.byInstance };
      for (const s of sessions) {
        if (s.status === "starting" || s.status === "running") {
          next[s.instanceId] = {
            ...(next[s.instanceId] ?? idleState()),
            phase: s.status === "running" ? "running" : "launching",
            sessionId: s.sessionId,
            pid: s.pid,
          };
        }
      }
      return { byInstance: next };
    }),
  onStarting: (instanceId, sessionId, pid) => {
    const s = getState().get(instanceId);
    if (["preparing", "downloading", "launching", "checking"].includes(s.phase)) {
      getState().patch(instanceId, { phase: "launching", sessionId, pid });
    }
  },
  onStarted: (instanceId, sessionId, pid) => {
    getState().patch(instanceId, { phase: "running", sessionId, pid, crashReason: null, exitCode: null });
  },
  onExit: (instanceId, sessionId, exitCode) => {
    const s = getState().get(instanceId);
    // Only ever honor the exit for the session this instance is tracking.
    // This blocks stale / out-of-order exit events from flipping an already
    // idle instance back to "stopped".
    if (s.sessionId !== sessionId) return;
    getState().patch(instanceId, { phase: "stopped", exitCode, error: null });
  },
  onCrash: (instanceId, sessionId, reason, exitCode) => {
    const s = getState().get(instanceId);
    if (s.sessionId !== sessionId) return;
    getState().patch(instanceId, { phase: "crashed", crashReason: reason, exitCode: exitCode ?? null });
  },
  noteDownloadActivity: () => {
    if (Date.now() - launchStartAt > 180_000) return;
    set((state) => {
      const next = { ...state.byInstance };
      for (const [id, s] of Object.entries(next)) {
        if (s.phase === "preparing") next[id] = { ...s, phase: "downloading" };
      }
      return { byInstance: next };
    });
  },
}));

export function markLaunchStart(): void {
  launchStartAt = Date.now();
}
