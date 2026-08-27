import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { accountsApi } from "../api/accountsApi";
import { contentApi } from "../api/contentApi";
import { instancesApi } from "../api/instancesApi";
import {
  marketApi,
  type MarketHomeParams,
  type MarketSearchParams,
} from "../api/marketApi";
import { downloadsApi, healthApi, launchApi, settingsApi } from "../api/launcherApi";
import { javaApi, loadersApi, versionsApi, type VersionsFilter } from "../api/systemApi";
import type {
  ContentKind,
  InstanceCreateInput,
  InstancePatchInput,
  MarketProviderId,
  SettingsPayload,
  YggdrasilLoginInput,
} from "../api/types";

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
  content: (id: string, kind: ContentKind) => ["instances", id, "content", kind] as const,
  contentDir: (id: string, kind: ContentKind) => ["instances", id, "content", kind, "dir"] as const,
  marketHome: ["market", "home"] as const,
  marketSearch: (params: MarketSearchParams) => ["market", "search", params] as const,
  marketItem: (id: string) => ["market", "item", id] as const,
  marketVersions: (id: string) => ["market", "item", id, "versions"] as const,
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

export function useJavaAdd() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => javaApi.add(path),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.java }),
  });
}

export function useJavaRemove() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => javaApi.remove(path),
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

// ---- instance content (mods / resourcepacks / shaderpacks) ----

export function useContent(instanceId: string | undefined, kind: ContentKind) {
  return useQuery({
    queryKey: qk.content(instanceId ?? "", kind),
    queryFn: () => contentApi.list(instanceId as string, kind),
    enabled: Boolean(instanceId),
  });
}

export function useContentDir(instanceId: string | undefined, kind: ContentKind) {
  return useQuery({
    queryKey: qk.contentDir(instanceId ?? "", kind),
    queryFn: () => contentApi.dir(instanceId as string, kind),
    enabled: Boolean(instanceId),
    staleTime: Infinity,
  });
}

export function useToggleContent(instanceId: string, kind: ContentKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ fileName, enabled }: { fileName: string; enabled: boolean }) =>
      contentApi.toggle(instanceId, kind, fileName, enabled),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.content(instanceId, kind) }),
  });
}

export function useRemoveContent(instanceId: string, kind: ContentKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fileName: string) => contentApi.remove(instanceId, kind, fileName),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.content(instanceId, kind) }),
  });
}

export function useUploadContent(instanceId: string, kind: ContentKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => contentApi.import(instanceId, kind, file),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.content(instanceId, kind) }),
  });
}

// ---- market ----

export function useMarketHome(filters?: MarketHomeParams) {
  return useQuery({
    queryKey: ["market", "home", filters ?? {}],
    queryFn: () => marketApi.home(filters),
    staleTime: 5 * 60_000,
  });
}

export function useMarketSearch(params: MarketSearchParams) {
  return useQuery({
    queryKey: qk.marketSearch(params),
    queryFn: () => marketApi.search(params),
    enabled: params.q.trim().length > 0,
    staleTime: 60_000,
  });
}

export function useMarketItem(id: string | undefined) {
  return useQuery({
    queryKey: qk.marketItem(id ?? ""),
    queryFn: () => marketApi.item(id as string),
    enabled: Boolean(id),
    staleTime: 30 * 60_000,
  });
}

export function useMarketVersions(id: string | undefined) {
  return useQuery({
    queryKey: qk.marketVersions(id ?? ""),
    queryFn: () => marketApi.versions(id as string),
    enabled: Boolean(id),
    staleTime: 60 * 60_000,
  });
}

export function useMarketInstalled(instanceId: string | undefined) {
  return useQuery({
    queryKey: ["market", "installed", instanceId ?? ""],
    queryFn: () => marketApi.installed(instanceId as string),
    enabled: Boolean(instanceId),
  });
}

export function useMarketInstall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { instanceId: string; provider: MarketProviderId; projectId: string; versionId: string }) =>
      marketApi.install(input),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ["market", "installed", vars.instanceId] });
    },
  });
}

export function useMarketUninstall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { instanceId: string; provider: MarketProviderId; projectId: string }) =>
      marketApi.uninstall(input),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ["market", "installed", vars.instanceId] });
    },
  });
}
