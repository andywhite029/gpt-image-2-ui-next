"use client";

// /api/config 查询 + 项目 CRUD hooks

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { endpoints, type ConfigResponse, type ProjectWithCounts } from "@/lib/api-client";
import type { ProjectOverview } from "@/types/entities";

export const queryKeys = {
  config: ["config"] as const,
  projects: (includeHidden: boolean) => ["projects", includeHidden] as const,
  projectOverview: (pid: string) => ["project", pid] as const,
  categories: (pid: string) => ["categories", pid] as const,
  conversations: (pid: string, cid?: string) => ["conversations", pid, cid ?? null] as const,
  conversation: (cid: string) => ["conversation", cid] as const,
  batch: (bid: string) => ["batch", bid] as const,
  images: (pid: string, filters?: Record<string, unknown>) => ["images", pid, filters ?? null] as const,
  imageDetail: (iid: string) => ["image", iid] as const,
  references: (pid: string) => ["references", pid] as const,
  trash: ["trash"] as const,
  search: (params: Record<string, unknown>) => ["search", params] as const,
  templates: ["templates"] as const,
};

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

export function useConfig(): UseQueryResult<ConfigResponse> {
  return useQuery({
    queryKey: queryKeys.config,
    queryFn: () => endpoints.config(),
    staleTime: 5 * 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// 项目
// ---------------------------------------------------------------------------

export function useProjects(includeHidden = true) {
  return useQuery({
    queryKey: queryKeys.projects(includeHidden),
    queryFn: async () => {
      const d = await endpoints.projects(includeHidden);
      return d.projects ?? [];
    },
  });
}

export function useProjectOverview(pid: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.projectOverview(pid),
    queryFn: () => endpoints.project(pid),
    enabled: !!pid && enabled,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (d: { name: string; type: string; description?: string }) =>
      endpoints.createProject(d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function usePatchProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pid, ...d }: { pid: string; name?: string; description?: string; archived?: boolean; hidden?: boolean }) =>
      endpoints.patchProject(pid, d),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: queryKeys.projectOverview(vars.pid) });
    },
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pid: string) => endpoints.deleteProject(pid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export type { ProjectOverview, ProjectWithCounts };
