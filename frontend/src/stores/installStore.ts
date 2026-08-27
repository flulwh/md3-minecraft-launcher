import { create } from "zustand";
import type { InstallationSnapshot } from "../api/types";

interface InstallStore {
  /** Live install snapshots, keyed by instance id. */
  active: Record<string, InstallationSnapshot>;
  update: (snap: InstallationSnapshot) => void;
  clear: (instanceId: string) => void;
}

export const installStore = create<InstallStore>((set) => ({
  active: {},
  update: (snap) =>
    set((state) => ({ active: { ...state.active, [snap.instanceId]: snap } })),
  clear: (instanceId) =>
    set((state) => {
      const next = { ...state.active };
      delete next[instanceId];
      return { active: next };
    }),
}));