import { create } from "zustand";
import type { RepairProgressData } from "../api/types";

interface RepairStore {
  active: Record<string, RepairProgressData>;
  update: (data: RepairProgressData) => void;
  finish: (instanceId: string) => void;
}

export const repairStore = create<RepairStore>((set) => ({
  active: {},
  update: (data) => set((state) => ({ active: { ...state.active, [data.instanceId]: data } })),
  finish: (instanceId) =>
    set((state) => {
      const next = { ...state.active };
      delete next[instanceId];
      return { active: next };
    }),
}));
