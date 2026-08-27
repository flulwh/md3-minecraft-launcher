/**
 * Installation state machine (design doc §3).
 *
 * The public phases follow:
 *   CREATED -> ANALYZING -> PLANNING -> PREPARING -> DOWNLOADING
 *          -> INSTALLING -> FINALIZING -> READY
 *
 * With non-terminal branches for interactivity:
 *   DOWNLOADING -> PAUSED <-> DOWNLOADING
 *   any active phase -> FAILED, and any -> RETRYING (retried in place)
 *   any phase -> CANCELLING -> CANCELLED
 */

export const INSTALL_PHASES = [
  "CREATED",
  "ANALYZING",
  "PLANNING",
  "PREPARING",
  "DOWNLOADING",
  "INSTALLING",
  "FINALIZING",
  "READY",
  "PAUSED",
  "RETRYING",
  "CANCELLING",
  "CANCELLED",
  "FAILED",
] as const;

export type InstallPhase = (typeof INSTALL_PHASES)[number];

/** Instance-level lifecycle statuses (design doc §4). */
export const INSTANCE_STATUS = [
  "CREATED",
  "INSTALLING",
  "READY",
  "BROKEN",
  "UPDATING",
  "UNINSTALLING",
  "DELETED",
] as const;

export type InstanceStatus = (typeof INSTANCE_STATUS)[number];

export type InstallControl = "run" | "pause" | "cancel";

const TERMINAL: ReadonlySet<InstallPhase> = new Set(["READY", "CANCELLED", "FAILED"]);

export function isInstallTerminal(phase: InstallPhase): boolean {
  return TERMINAL.has(phase);
}

export function isInstallActive(phase: InstallPhase): boolean {
  return (
    !TERMINAL.has(phase) &&
    phase !== "CREATED" &&
    phase !== "PAUSED"
  );
}

/** Maps an install phase onto the instance-level status column. */
export function instanceStatusForPhase(phase: InstallPhase): InstanceStatus {
  switch (phase) {
    case "READY":
      return "READY";
    case "FAILED":
      return "BROKEN";
    case "CANCELLED":
      return "CREATED";
    default:
      return "INSTALLING";
  }
}

const ALLOWED: Record<InstallPhase, InstallPhase[]> = {
  CREATED: ["ANALYZING", "FAILED", "CANCELLED"],
  ANALYZING: ["PLANNING", "FAILED", "CANCELLED"],
  PLANNING: ["PREPARING", "FAILED", "CANCELLED"],
  PREPARING: ["DOWNLOADING", "FAILED", "CANCELLED"],
  DOWNLOADING: ["INSTALLING", "PAUSED", "RETRYING", "FAILED", "CANCELLED"],
  INSTALLING: ["FINALIZING", "FAILED", "CANCELLED"],
  FINALIZING: ["READY", "FAILED", "CANCELLED"],
  READY: [],
  PAUSED: ["DOWNLOADING", "CANCELLED", "FAILED"],
  RETRYING: ["DOWNLOADING", "FAILED", "CANCELLED"],
  CANCELLING: ["CANCELLED", "FAILED"],
  CANCELLED: [],
  FAILED: [],
};

/**
 * Validates a phase transition. Throws when the move is not part of the state
 * machine so a mis-wired orchestrator fails loudly instead of corrupting state.
 */
export function transition(from: InstallPhase, to: InstallPhase): void {
  if (from === to) return;
  if (!ALLOWED[from]!.includes(to)) {
    throw new Error(`Illegal installation phase transition: ${from} -> ${to}`);
  }
}