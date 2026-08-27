import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MarketContentType, MarketSortIndex } from "../api/types";

/**
 * Global market browsing context. `instanceId` selects a local instance the
 * market is adapted to (its loader + game version filter everything). `adapter`
 * lets a user override the auto-derived filters per invocation; '' means
 * "follow the instance". `categories` are selected Modrinth content tags.
 */
interface MarketState {
  instanceId: string | null;
  adapterLevel: MarketContentType; // which content type gets loader/version adaptation
  loader: string;
  version: string;
  categories: string[];
  sort: MarketSortIndex;
  clearVersion: boolean;
  setInstance: (id: string | null) => void;
  setAdapterLevel: (t: MarketContentType) => void;
  setLoader: (l: string) => void;
  setVersion: (v: string) => void;
  setClearVersion: (b: boolean) => void;
  toggleCategory: (c: string) => void;
  setSort: (s: MarketSortIndex) => void;
  resetFilters: () => void;
}

export const marketStore = create<MarketState>()(
  persist(
    (set) => ({
      instanceId: null,
      adapterLevel: "mod",
      loader: "",
      version: "",
      categories: [],
      sort: "relevance",
      clearVersion: false,
      setInstance: (instanceId) =>
        set({ instanceId, loader: "", version: "", clearVersion: false }),
      setAdapterLevel: (adapterLevel) => set({ adapterLevel }),
      setLoader: (loader) => set({ loader }),
      setVersion: (version) => set({ version }),
      setClearVersion: (clearVersion) => set({ clearVersion }),
      toggleCategory: (c) =>
        set((s) => ({
          categories: s.categories.includes(c)
            ? s.categories.filter((x) => x !== c)
            : [...s.categories, c],
        })),
      setSort: (sort) => set({ sort }),
      resetFilters: () =>
        set({ loader: "", version: "", categories: [], clearVersion: false, sort: "relevance" }),
    }),
    {
      name: "launcher-market",
      partialize: (s) => ({
        instanceId: s.instanceId,
        loader: s.loader,
        version: s.version,
        categories: s.categories,
        sort: s.sort,
        clearVersion: s.clearVersion,
      }),
    },
  ),
);