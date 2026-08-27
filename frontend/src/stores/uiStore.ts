import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "system" | "light" | "dark";

interface UiState {
  mode: ThemeMode;
  sidebarExpanded: boolean;
  currentAccountId: string | null;
  paletteOpen: boolean;
  setMode: (mode: ThemeMode) => void;
  toggleSidebar: () => void;
  setCurrentAccount: (id: string | null) => void;
  setPaletteOpen: (open: boolean) => void;
}

export const uiStore = create<UiState>()(
  persist(
    (set) => ({
      mode: "system",
      sidebarExpanded: true,
      currentAccountId: null,
      paletteOpen: false,
      setMode: (mode) => set({ mode }),
      toggleSidebar: () => set((s) => ({ sidebarExpanded: !s.sidebarExpanded })),
      setCurrentAccount: (currentAccountId) => set({ currentAccountId }),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
    }),
    {
      name: "launcher-ui",
      partialize: (s) => ({
        mode: s.mode,
        sidebarExpanded: s.sidebarExpanded,
        currentAccountId: s.currentAccountId,
      }),
    },
  ),
);
