"use client";

// 参考图库 / 回收站 hooks

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { endpoints } from "@/lib/api-client";
import { queryKeys } from "@/hooks/use-projects";
import type { ReferenceSummary, TrashItem } from "@/types/entities";

// ---------------------------------------------------------------------------
// 参考图
// ---------------------------------------------------------------------------

export function useReferences(pid: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.references(pid),
    queryFn: async (): Promise<ReferenceSummary[]> => {
      const d = await endpoints.references(pid);
      return d.references ?? [];
    },
    enabled: !!pid && enabled,
  });
}

export function useUploadReferences(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (files: File[]) => endpoints.uploadReferences(pid, files),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.references(pid) });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function usePatchReference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      rid,
      ...d
    }: {
      rid: string;
      pid?: string;
      name?: string;
      user_note?: string;
      tags?: string[];
      is_favorited?: boolean;
    }) => endpoints.patchReference(rid, d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["references"] });
    },
  });
}

export function useDeleteReference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rid: string) => endpoints.deleteReference(rid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["references"] });
      qc.invalidateQueries({ queryKey: ["trash"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

// ---------------------------------------------------------------------------
// 回收站
// ---------------------------------------------------------------------------

export function useTrash(enabled = true) {
  return useQuery({
    queryKey: queryKeys.trash,
    queryFn: async (): Promise<TrashItem[]> => {
      const d = await endpoints.trash();
      return d.items ?? [];
    },
    enabled,
  });
}

export function useRestoreTrash() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, eid }: { type: string; eid: string }) => endpoints.restore(type, eid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trash"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["images"] });
      qc.invalidateQueries({ queryKey: ["references"] });
    },
  });
}

export function usePurgeTrash() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, eid }: { type: string; eid: string }) => endpoints.purgeTrash(type, eid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trash"] });
    },
  });
}

export function useEmptyTrash() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => endpoints.emptyTrash(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trash"] });
    },
  });
}
