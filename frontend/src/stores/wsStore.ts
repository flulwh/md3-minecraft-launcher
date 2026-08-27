import { create } from "zustand";

interface WsState {
  connected: boolean;
  lastConnectedAt: number | null;
  setConnected: (connected: boolean) => void;
}

export const wsStore = create<WsState>((set) => ({
  connected: false,
  lastConnectedAt: null,
  setConnected: (connected) =>
    set(connected ? { connected, lastConnectedAt: Date.now() } : { connected }),
}));
