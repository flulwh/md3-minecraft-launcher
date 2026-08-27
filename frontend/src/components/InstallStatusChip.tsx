import Chip from "@mui/material/Chip";
import { useNavigate } from "react-router-dom";
import type { InstallPhase } from "../api/types";
import { AppIcon } from "../design-system/AppIcon";
import { INSTALL_PHASE_LABEL, installPhaseColor } from "../lib/installPhase";
import { installStore } from "../stores/installStore";

function phaseIcon(phase: InstallPhase): string {
  switch (phase) {
    case "PAUSED":
      return "pause_circle";
    case "FAILED":
      return "error";
    case "READY":
      return "check_circle";
    case "CANCELLED":
    case "CANCELLING":
      return "cancel";
    default:
      return "sync";
  }
}

/**
 * Install status shown on instance cards. Uses the live WebSocket snapshot when
 * one exists (so it stays in sync with the detail panel / download center even
 * during PAUSED or intermediate phases), and falls back to the persisted DB
 * status when no install session is active.
 */
export function InstallStatusChip({
  instanceId,
  status,
}: {
  instanceId: string;
  status: string;
}) {
  const navigate = useNavigate();
  const snap = installStore((s) => s.active[instanceId]);

  if (snap) {
    return (
      <Chip
        size="small"
        color={installPhaseColor(snap.phase)}
        icon={<AppIcon name={phaseIcon(snap.phase)} size={13} filled />}
        label={INSTALL_PHASE_LABEL[snap.phase]}
        title={snap.message ? `${INSTALL_PHASE_LABEL[snap.phase]}：${snap.message}` : INSTALL_PHASE_LABEL[snap.phase]}
      />
    );
  }

  if (status === "BROKEN") {
    return (
      <Chip
        size="small"
        color="error"
        icon={<AppIcon name="build" size={13} filled />}
        clickable
        label="需修复"
        title="点击进入修复入口"
        onClick={(e) => {
          e.stopPropagation();
          navigate(`/instances/${instanceId}?tab=settings`);
        }}
      />
    );
  }
  if (status === "CREATED") {
    return <Chip size="small" color="warning" label="未安装" />;
  }
  if (status === "INSTALLING" || status === "UPDATING") {
    return <Chip size="small" color="info" label="安装中" />;
  }
  return null;
}
