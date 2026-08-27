import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import { useEffect, useState } from "react";
import { AppIcon } from "../design-system/AppIcon";
import { launchStore } from "../stores/launchStore";
import { forceStopSession, previewLaunch, startLaunch, stopElapsedMs, stopSession } from "../lib/actions";

export interface LaunchButtonProps {
  instanceId: string;
  size?: "small" | "medium" | "large";
}

const PHASE_LABEL: Record<string, string> = {
  checking: "检查中…",
  preparing: "准备中…",
  downloading: "下载中…",
  launching: "启动中…",
  running: "运行中",
  stopping: "停止中…",
};

/** Backend force-kills after 30s of a graceful stop; show how long is left. */
const GRACEFUL_STOP_TIMEOUT_MS = 30_000;

export function LaunchButton({ instanceId, size = "medium" }: LaunchButtonProps) {
  const phase = launchStore((s) => s.byInstance[instanceId]?.phase ?? "idle");
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [tick, setTick] = useState(0);

  // Re-render every second while stopping so the countdown stays live.
  useEffect(() => {
    if (phase !== "stopping") return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [phase, tick === 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const busyPhases = ["checking", "preparing", "downloading", "launching", "stopping"];
  const runningLike = ["running", "launching"].includes(phase);
  const crashed = phase === "crashed";
  const remainSec =
    phase === "stopping" ? Math.max(0, Math.ceil((GRACEFUL_STOP_TIMEOUT_MS - stopElapsedMs(instanceId)) / 1000)) : 0;

  if (runningLike || phase === "stopping") {
    return (
      <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.25 }}>
        <Button
          size={size}
          color="error"
          variant="outlined"
          disabled={phase === "stopping"}
          startIcon={<AppIcon name="stop" filled size={18} />}
          onClick={() => void stopSession(instanceId)}
        >
          {phase === "stopping" ? `停止中…${remainSec > 0 ? `(${remainSec}s)` : ""}` : "停止游戏"}
        </Button>
        {phase === "stopping" && (
          <>
            <Button
              size={size}
              variant="text"
              startIcon={<AppIcon name="more_vert" size={18} />}
              aria-label="停止操作"
              aria-haspopup="menu"
              onClick={(e) => setMenuAnchor(e.currentTarget)}
              sx={{ minWidth: 0, px: 1 }}
            />
            <Menu anchorEl={menuAnchor} open={menuAnchor !== null} onClose={() => setMenuAnchor(null)}>
              <MenuItem
                onClick={() => {
                  setMenuAnchor(null);
                  void forceStopSession(instanceId);
                }}
              >
                <ListItemIcon>
                  <AppIcon name="power_settings_new" size={18} />
                </ListItemIcon>
                立即强制停止
              </MenuItem>
            </Menu>
          </>
        )}
      </Box>
    );
  }

  return (
    <>
      <Button
        size={size}
        variant="contained"
        color={crashed ? "error" : "primary"}
        disabled={busyPhases.includes(phase)}
        startIcon={
          busyPhases.includes(phase) ? (
            <CircularProgress size={16} color="inherit" />
          ) : (
            <AppIcon name={crashed ? "build" : "play_arrow"} filled size={18} />
          )
        }
        onClick={() => void startLaunch(instanceId)}
        aria-label={crashed ? "修复并重新启动" : "启动游戏"}
      >
        {PHASE_LABEL[phase] ?? (crashed ? "重新启动" : "启动游戏")}
      </Button>
      {!busyPhases.includes(phase) && (
        <>
          <Button
            size={size}
            variant="text"
            startIcon={<AppIcon name="more_vert" size={18} />}
            aria-label="更多启动操作"
            aria-haspopup="menu"
            onClick={(e) => setMenuAnchor(e.currentTarget)}
            sx={{ minWidth: 0, px: 1 }}
          />
          <Menu anchorEl={menuAnchor} open={menuAnchor !== null} onClose={() => setMenuAnchor(null)}>
            <MenuItem
              onClick={() => {
                setMenuAnchor(null);
                void previewLaunch(instanceId);
              }}
            >
              <ListItemIcon>
                <AppIcon name="fact_check" size={18} />
              </ListItemIcon>
              仅预检（不启动）
            </MenuItem>
          </Menu>
        </>
      )}
    </>
  );
}
