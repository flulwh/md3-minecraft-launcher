import { http } from "./http";
import type {
  CrashIncidentResponse,
  DownloadsResponse,
  HistorySession,
  LaunchResult,
  LiveSession,
  SettingsPayload,
} from "./types";

export interface LaunchOptionsInput {
  instanceId: string;
  accountId: string;
  dryRun?: boolean;
  skipPreflight?: boolean;
}

export const downloadsApi = {
  list: (): Promise<DownloadsResponse> => http.get("/api/v1/downloads"),
  control: (
    taskId: string,
    action: "pause" | "resume" | "cancel",
  ): Promise<{ taskId: string; action: string }> =>
    http.post(`/api/v1/downloads/${taskId}/${action}`),
};

export const launchApi = {
  launch: (opts: LaunchOptionsInput): Promise<LaunchResult> =>
    http.post("/api/v1/launch", opts),
  preview: (instanceId: string, accountId: string): Promise<LaunchResult> =>
    http.post("/api/v1/launch/preview", { instanceId, accountId }),
  liveSessions: (): Promise<{ live: true; sessions: LiveSession[] }> =>
    http.get("/api/v1/launch/sessions?live=1"),
  historySessions: (limit = 20): Promise<{ live: false; sessions: HistorySession[] }> =>
    http.get(`/api/v1/launch/sessions?limit=${limit}`),
  stop: (sessionId: string): Promise<unknown> =>
    http.post(`/api/v1/launch/sessions/${sessionId}/stop`),
  kill: (sessionId: string): Promise<unknown> =>
    http.post(`/api/v1/launch/sessions/${sessionId}/kill`),
  incident: (sessionId: string): Promise<CrashIncidentResponse> =>
    http.get(`/api/v1/launch/sessions/${sessionId}/incident`),
};

export const settingsApi = {
  get: (): Promise<SettingsPayload> => http.get("/api/v1/settings"),
  update: (patch: SettingsPayload): Promise<SettingsPayload> =>
    http.put("/api/v1/settings", patch),
};

export const healthApi = {
  get: () => http.get<{ status: string; uptimeSec: number; version: string }>("/api/v1/health"),
};
