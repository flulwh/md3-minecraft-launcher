import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { accountsApi } from "../api/accountsApi";
import { instancesApi } from "../api/instancesApi";
import { downloadsApi, healthApi, launchApi, settingsApi } from "../api/launcherApi";
import { javaApi, loadersApi, versionsApi, type VersionsFilter } from "../api/systemApi";
import type { InstanceCreateInput, InstancePatchInput, SettingsPayload, YggdrasilLoginInput } from "../api/types";

export const qk = {
  health: ["health"] as const,
  instances: ["instances"] as const,
  instance: (id: string) => ["instances", id] as const,
  accounts: ["accounts"] as const,
  java: ["java"] as const,
  versions: (filter: VersionsFilter) => ["versions", filter] as const,
  loaders: ["loaders"] as const,
  loaderVersions: (loader: string, mc: string) => ["loaderVersions", loader, mc] as const,
  downloads: ["downloads"] as const,
  liveSessions: ["sessions", "live"] as const,
  historySessions: ["sessions", "history"] as const,
  settings: ["settings"] as const,
};

export function useHealth() {
  return useQuery({
    queryKey: qk.health,
    queryFn: () => healthApi.get(),
    refetchInterval: 30_000,
    retry: 1,
  });
}

export function useInstances() {
  return useQuery({ queryKey: qk.instances, queryFn: () => instancesApi.list() });
}

export function useInstance(id: string | undefined) {
  return useQuery({
    queryKey: qk.instance(id ?? ""),
    queryFn: () => instancesApi.get(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: InstanceCreateInput) => instancesApi.create(input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.instances }),
  });
}

export function useUpdateInstance(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: InstancePatchInput) => instancesApi.update(id, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.instances });
      void qc.invalidateQueries({ queryKey: qk.instance(id) });
    },
  });
}

export function useDeleteInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => instancesApi.remove(id),
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: qk.instances });
      qc.removeQueries({ queryKey: qk.instance(id) });
    },
  });
}

export function useRepairInstance(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => instancesApi.repair(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.instance(id) }),
  });
}

export function useAccounts() {
  return useQuery({ queryKey: qk.accounts, queryFn: () => accountsApi.list() });
}

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => accountsApi.remove(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.accounts }),
  });
}

export function useOfflineLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (username: string) => accountsApi.createOffline(username),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.accounts }),
  });
}

export function useYggdrasilLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: YggdrasilLoginInput) => accountsApi.loginYggdrasil(input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.accounts }),
  });
}

export function useJavaRuntimes() {
  return useQuery({ queryKey: qk.java, queryFn: () => javaApi.runtimes(), staleTime: 60_000 });
}

export function useJavaScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => javaApi.scan(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.java }),
  });
}

export function useVersions(filter: VersionsFilter) {
  return useQuery({
    queryKey: qk.versions(filter),
    queryFn: () => versionsApi.list(filter),
    staleTime: 10 * 60_000,
  });
}

export function useLoaders() {
  return useQuery({ queryKey: qk.loaders, queryFn: () => loadersApi.list(), staleTime: Infinity });
}

export function useLoaderVersions(loader: string | undefined, mc: string | undefined) {
  return useQuery({
    queryKey: qk.loaderVersions(loader ?? "", mc ?? ""),
    queryFn: () => loadersApi.versions(loader as string, mc as string),
    enabled: Boolean(loader && mc && loader !== "vanilla"),
  });
}

export function useDownloads() {
  return useQuery({ queryKey: qk.downloads, queryFn: () => downloadsApi.list() });
}

export function useDownloadControl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { taskId: string; action: "pause" | "resume" | "cancel" }) =>
      downloadsApi.control(args.taskId, args.action),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.downloads }),
  });
}

export function useLiveSessions() {
  return useQuery({ queryKey: qk.liveSessions, queryFn: () => launchApi.liveSessions() });
}

export function useHistorySessions(limit = 50) {
  return useQuery({
    queryKey: [...qk.historySessions, limit],
    queryFn: () => launchApi.historySessions(limit),
  });
}

export function useSettings() {
  return useQuery({ queryKey: qk.settings, queryFn: () => settingsApi.get() });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsPayload) => settingsApi.update(patch),
    onSuccess: (data) => qc.setQueryData(qk.settings, data),
  });
}
