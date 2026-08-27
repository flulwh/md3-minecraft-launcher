/**
 * Installation state machine (design doc §3).
 *
 * The public phases follow:
 *   CREATED -> ANALYZING -> PREPARING -> PLANNING -> DOWNLOADING
 *          -> INSTALLING -> FINALIZING -> READY
 *
 * PREPARING (loader build) runs BEFORE PLANNING because the loader's generated
 * version JSON is required to resolve the version id and enumerate the install
 * plan's tasks. Vanilla instances skip PREPARING and go ANALYZING -> PLANNING.
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
  // Loader build (PREPARING) precedes plan generation (PLANNING): the loader's
  // generated version JSON is required to resolve the version id / enumerate the
  // plan's tasks. Vanilla instances go ANALYZING -> PLANNING directly.
  ANALYZING: ["PLANNING", "PREPARING", "CANCELLING", "FAILED", "CANCELLED"],
  PLANNING: ["PREPARING", "DOWNLOADING", "CANCELLING", "FAILED", "CANCELLED"],
  PREPARING: ["PLANNING", "DOWNLOADING", "CANCELLING", "FAILED", "CANCELLED"],
  DOWNLOADING: ["INSTALLING", "PAUSED", "RETRYING", "CANCELLING", "FAILED", "CANCELLED"],
  INSTALLING: ["FINALIZING", "PAUSED", "CANCELLING", "FAILED", "CANCELLED"],
  FINALIZING: ["READY", "CANCELLING", "FAILED", "CANCELLED"],
  READY: [],
  // PAUSED can resume into any subsequent phase — not just DOWNLOADING — because
  // a pause may be captured between phases or even during loader build in
  // PREPARING. run() re-enters at ANALYZING, so resuming must allow the full
  // ANALYZING -> PREPARING -> PLANNING chain as well.
  PAUSED: ["ANALYZING", "PLANNING", "PREPARING", "DOWNLOADING", "INSTALLING", "FINALIZING", "CANCELLING", "CANCELLED", "FAILED"],
  RETRYING: ["DOWNLOADING", "CANCELLING", "FAILED", "CANCELLED"],
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