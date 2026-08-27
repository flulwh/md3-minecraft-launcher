import { app, BrowserWindow, clipboard, ipcMain, shell } from "electron";
import path from "node:path";

const DEV_URL = app.isPackaged ? undefined : "http://127.0.0.1:5173";

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    frame: false,
    backgroundColor: "#12140e",
    titleBarStyle: "hidden",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.on("ready-to-show", () => win.show());
  win.on("maximize", () => win.webContents.send("window:maximized", true));
  win.on("unmaximize", () => win.webContents.send("window:maximized", false));

  if (!app.isPackaged) {
    win.webContents.on("console-message", (...args: unknown[]) => {
      const detail = args[1] as
        | { message?: string; sourceId?: string; lineNumber?: number }
        | undefined;
      const legacyMessage = args[2];
      const message =
        detail && typeof detail === "object" && "message" in detail
          ? `${detail.message} (${detail.sourceId ?? ""}:${detail.lineNumber ?? ""})`
          : String(legacyMessage ?? "");
      if (message.length > 0) console.log("[renderer]", message);
    });
  }

  if (DEV_URL) {
    void win.loadURL(DEV_URL);
  } else {
    void win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

ipcMain.handle("window:minimize", (e) => {
  BrowserWindow.fromWebContents(e.sender)?.minimize();
});

ipcMain.handle("window:maximizeToggle", (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w) return;
  if (w.isMaximized()) w.unmaximize();
  else w.maximize();
});

ipcMain.handle("window:close", (e) => {
  BrowserWindow.fromWebContents(e.sender)?.close();
});

ipcMain.handle("window:isMaximized", (e) => {
  return BrowserWindow.fromWebContents(e.sender)?.isMaximized() ?? false;
});

ipcMain.handle("shell:openPath", (_e, p: string) => shell.openPath(p));
ipcMain.handle("shell:revealItem", (_e, p: string) => shell.showItemInFolder(p));
ipcMain.handle("shell:openExternal", (_e, url: string) => {
  if (/^https?:\/\//.test(url)) void shell.openExternal(url);
});

ipcMain.handle("clipboard:writeText", (_e, text: string) => {
  clipboard.writeText(text);
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
