import { create } from "zustand";

export interface ToastItem {
  id: number;
  message: string;
  severity: "success" | "error" | "info" | "warning";
}

interface ToastState {
  toasts: ToastItem[];
  push: (message: string, severity?: ToastItem["severity"]) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const toastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (message, severity = "info") =>
    set((s) => ({ toasts: [...s.toasts, { id: nextId++, message, severity }] })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  success: (m: string): void => toastStore.getState().push(m, "success"),
  error: (m: string): void => toastStore.getState().push(m, "error"),
  info: (m: string): void => toastStore.getState().push(m, "info"),
  warning: (m: string): void => toastStore.getState().push(m, "warning"),
};
