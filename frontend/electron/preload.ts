import { contextBridge, ipcRenderer } from "electron";

const api = {
  platform: process.platform,
  minimize: (): Promise<void> => ipcRenderer.invoke("window:minimize"),
  maximizeToggle: (): Promise<void> => ipcRenderer.invoke("window:maximizeToggle"),
  close: (): Promise<void> => ipcRenderer.invoke("window:close"),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke("window:isMaximized"),
  onMaximizedChange: (cb: (maximized: boolean) => void): (() => void) => {
    const listener = (_e: unknown, v: boolean): void => cb(v);
    ipcRenderer.on("window:maximized", listener);
    return () => ipcRenderer.removeListener("window:maximized", listener);
  },
  openPath: (p: string): Promise<string> => ipcRenderer.invoke("shell:openPath", p),
  revealItem: (p: string): Promise<void> => ipcRenderer.invoke("shell:revealItem", p),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke("shell:openExternal", url),
  writeText: (text: string): Promise<void> => ipcRenderer.invoke("clipboard:writeText", text),
};

contextBridge.exposeInMainWorld("launcher", api);

export type LauncherApi = typeof api;
