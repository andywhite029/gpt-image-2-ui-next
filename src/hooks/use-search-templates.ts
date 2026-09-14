"use client";

// 搜索 / 模板 hooks

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { endpoints } from "@/lib/api-client";
import { queryKeys } from "@/hooks/use-projects";
import type { SearchResult, Template } from "@/types/entities";

// ---------------------------------------------------------------------------
// 搜索
// ---------------------------------------------------------------------------

export interface SearchParams {
  q?: string;
  project_id?: string;
  favorites?: boolean;
  reference_library?: boolean;
  uncategorized?: boolean;
  sort?: string;
}

export function useSearch(params: SearchParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.search(params as Record<string, unknown>),
    queryFn: async (): Promise<SearchResult[]> => {
      const d = await endpoints.search(params);
      return d.results ?? [];
    },
    enabled,
  });
}

// ---------------------------------------------------------------------------
// 模板
// ---------------------------------------------------------------------------

export function useTemplates(enabled = true) {
  return useQuery({
    queryKey: queryKeys.templates,
    queryFn: async (): Promise<Template[]> => {
      const d = await endpoints.templates();
      return d.templates ?? [];
    },
    enabled,
  });
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (d: {
      name: string;
      prompt: string;
      negative_prompt?: string;
      size?: string;
      quality?: string;
      n?: number;
    }) => endpoints.createTemplate(d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.templates });
    },
  });
}

export function usePatchTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tid, ...d }: { tid: number } & Partial<Template>) => endpoints.patchTemplate(tid, d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.templates });
    },
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tid: number) => endpoints.deleteTemplate(tid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.templates });
    },
  });
}
