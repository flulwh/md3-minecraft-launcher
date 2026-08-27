import Box from "@mui/material/Box";
import Snackbar from "@mui/material/Snackbar";
import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import type { DownloadProgressData, EventEnvelope } from "../api/types";
import { CommandPalette } from "./CommandPalette";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { TitleBar } from "./TitleBar";
import { downloadStore } from "../stores/downloadStore";
import { launchStore } from "../stores/launchStore";
import { logStore } from "../stores/logStore";
import { repairStore } from "../stores/repairStore";
import { toastStore } from "../stores/toastStore";
import { uiStore } from "../stores/uiStore";
import { wsStore } from "../stores/wsStore";
import { wsClient } from "../ws/wsClient";
import { useQueryClient } from "@tanstack/react-query";
import { qk } from "../hooks/queries";
import { useDownloads, useLiveSessions } from "../hooks/queries";
import { bindActions } from "../lib/actions";
import { startLaunch } from "../lib/actions";
import { STATUSBAR_HEIGHT } from "../theme/tokens";

function dispatchWsEvent(env: EventEnvelope, qc: ReturnType<typeof useQueryClient>): void {
  switch (env.type) {
    case "download.progress": {
      // Progress frames arrive batched ({ tasks: [...] }) to keep the renderer
      // from processing dozens of frames per second during multi-file downloads.
      const d = env.data as
        | DownloadProgressData
        | { tasks: DownloadProgressData[] };
      const list = Array.isArray((d as { tasks?: unknown }).tasks)
        ? (d as { tasks: DownloadProgressData[] }).tasks
        : [d as DownloadProgressData];
      downloadStore.getState().onProgressBatch(list);
      break;
    }
    case "download.completed": {
      // Batched payload may carry many completions at once (asset downloads);
      // apply them together and trigger a single downloads refetch.
      const d = env.data as
        | { taskId: string }
        | { tasks: Array<{ taskId: string }> };
      const ids = Array.isArray((d as { tasks?: unknown }).tasks)
        ? (d as { tasks: Array<{ taskId: string }> }).tasks.map((t) => t.taskId)
        : [(d as { taskId: string }).taskId];
      for (const tid of ids) downloadStore.getState().onCompleted(tid);
      void qc.invalidateQueries({ queryKey: qk.downloads });
      break;
    }
    case "download.failed":
      downloadStore.getState().onFailed(
        (env.data as { taskId: string }).taskId,
        (env.data as { error?: string }).error,
      );
      void qc.invalidateQueries({ queryKey: qk.downloads });
      break;
    case "repair.progress":
      repairStore.getState().update(env.data as import("../api/types").RepairProgressData);
      break;
    case "minecraft.starting": {
      const d = env.data as { pid: number | null; sessionId: string };
      launchStore.getState().onStarting(env.instanceId ?? "", d.sessionId, d.pid);
      break;
    }
    case "minecraft.started": {
      const d = env.data as { pid: number | null; sessionId: string };
      launchStore.getState().onStarted(env.instanceId ?? "", d.sessionId, d.pid);
      break;
    }
    case "minecraft.log":
      if (env.instanceId) logStore.getState().append(env.instanceId, env.data as import("../api/types").MinecraftLogData);
      break;
    case "minecraft.exit": {
      const d = env.data as { exitCode: number | null; signal?: string | null; sessionId: string };
      launchStore.getState().onExit(env.instanceId ?? "", d.sessionId, d.exitCode);
      void qc.invalidateQueries({ queryKey: qk.liveSessions });
      void qc.invalidateQueries({ queryKey: qk.historySessions });
      break;
    }
    case "minecraft.crash": {
      const d = env.data as { reason: string; exitCode?: number | null; sessionId: string };
      launchStore.getState().onCrash(env.instanceId ?? "", d.sessionId, d.reason, d.exitCode ?? null);
      toastStore.getState().push(`Minecraft 异常退出：${d.reason}`, "error");
      void qc.invalidateQueries({ queryKey: qk.liveSessions });
      break;
    }
    case "instance.updated": {
      const d = env.data as { id: string; action: string };
      void qc.invalidateQueries({ queryKey: qk.instances });
      if (d.action !== "deleted") void qc.invalidateQueries({ queryKey: qk.instance(d.id) });
      break;
    }
    case "java.scan.done":
      void qc.invalidateQueries({ queryKey: qk.java });
      break;
    default:
      break;
  }
}

export function AppShell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const live = useLiveSessions();
  const downloads = useDownloads();

  useEffect(() => {
    bindActions({ qc, navigate: (p) => navigate(p) });
    wsClient.connect();
    return wsClient.on((env) => dispatchWsEvent(env, qc));
  }, [qc, navigate]);

  useEffect(() => {
    if (live.data) launchStore.getState().hydrate(live.data.sessions);
  }, [live.data]);

  useEffect(() => {
    if (downloads.data) downloadStore.getState().applyInitial(downloads.data.tasks);
  }, [downloads.data]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        if (e.key.toLowerCase() === "k") {
          e.preventDefault();
          uiStore.getState().setPaletteOpen(!uiStore.getState().paletteOpen);
          return;
        }
        if (e.key === "Enter") {
          const target = e.target as HTMLElement | null;
          if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
          e.preventDefault();
          const history = qc.getQueryData<{ sessions: { instanceId: string; startedAt: string }[] }>(
            [...qk.historySessions],
          );
          const last = history?.sessions?.[0]?.instanceId;
          if (last) void startLaunch(last);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [qc]);

  const connected = wsStore((s) => s.connected);
  const toasts = toastStore((s) => s.toasts);
  const dismissToast = toastStore((s) => s.dismiss);

  return (
    <Box sx={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TitleBar />
      <Box sx={{ flex: 1, display: "flex", minHeight: 0 }}>
        <Sidebar />
        <Box component="main" sx={{ flex: 1, minWidth: 0, overflowY: "auto" }} aria-live="polite">
          <Outlet />
        </Box>
        {!connected && (
          <Box
            role="status"
            sx={{
              position: "fixed",
              top: 8,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: (t) => t.zIndex.snackbar,
              px: 1.5,
              py: 0.75,
              borderRadius: 2,
              bgcolor: "warning.container",
              color: "warning.onContainer",
              typography: "caption",
              fontWeight: 500,
              boxShadow: 1,
            }}
          >
            后端连接已断开，正在重连…
          </Box>
        )}
      </Box>
      <StatusBar />
      <CommandPalette />
      {toasts.map((t) => (
        <Snackbar
          key={t.id}
          open
          autoHideDuration={4000}
          onClose={() => dismissToast(t.id)}
          message={t.message}
          anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
          sx={{ bottom: `calc(${STATUSBAR_HEIGHT}px + 16px)` }}
        />
      ))}
    </Box>
  );
}
