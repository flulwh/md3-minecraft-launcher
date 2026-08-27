import { create } from "zustand";
import type { DownloadProgressData, DownloadTaskSnapshot } from "../api/types";

interface DownloadStore {
  overrides: Record<string, DownloadTaskSnapshot>;
  lastEventAt: number;
  applyInitial: (tasks: DownloadTaskSnapshot[]) => void;
  onProgress: (data: DownloadProgressData) => void;
  onProgressBatch: (list: DownloadProgressData[]) => void;
  onCompleted: (taskId: string) => void;
  onFailed: (taskId: string, error?: string) => void;
}

export const downloadStore = create<DownloadStore>((set, getState) => ({
  overrides: {},
  lastEventAt: 0,
  applyInitial: (tasks) => {
    const stale = new Set(Object.keys(getState().overrides));
    for (const t of tasks) {
      if (["completed", "failed", "cancelled"].includes(t.status)) stale.delete(t.taskId);
    }
    set((state) => {
      const next = { ...state.overrides };
      for (const taskId of stale) delete next[taskId];
      return { ...state, overrides: next };
    });
  },
  onProgress: (data) => downloadStore.getState().onProgressBatch([data]),
  onProgressBatch: (list) =>
    set((state) => {
      const overrides = { ...state.overrides };
      for (const data of list) {
        const prev = overrides[data.taskId];
        overrides[data.taskId] = {
          taskId: data.taskId,
          kind: data.kind as DownloadTaskSnapshot["kind"],
          dest: prev?.dest ?? data.taskId,
          status: "downloading",
          receivedBytes: data.receivedBytes,
          totalBytes: data.totalBytes,
          progressPct: data.progressPct,
          speedBps: data.speedBps,
          etaSec: data.etaSec,
        };
      }
      return { lastEventAt: Date.now(), overrides };
    }),
  onCompleted: (taskId) => set((state) => removeKey(state, taskId)),
  onFailed: (taskId) => set((state) => removeKey(state, taskId)),
}));

function removeKey(
  state: Pick<DownloadStore, "overrides">,
  taskId: string,
): Pick<DownloadStore, "overrides"> {
  const next = { ...state.overrides };
  delete next[taskId];
  return { overrides: next };
}
