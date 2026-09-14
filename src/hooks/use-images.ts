"use client";

// 图片列表 / 收藏 / 删除 / 详情 hooks

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { endpoints, type ImageListResponse, type ImageDetailResponse } from "@/lib/api-client";
import { queryKeys } from "@/hooks/use-projects";
import type { Category } from "@/types/entities";

export interface ImageFilters {
  category_id?: string;
  favorites?: boolean;
  uncategorized?: boolean;
  limit?: number;
  offset?: number;
  sort?: string;
}

export function useImages(
  pid: string | null,
  filters: ImageFilters = {},
  enabled = true
): UseQueryResult<ImageListResponse> {
  const key = { ...filters };
  return useQuery({
    queryKey: ["images", pid, key],
    queryFn: () => endpoints.images(pid!, filters as Record<string, string | number | boolean | null>),
    enabled: !!pid && enabled,
    staleTime: 5_000,
  });
}

export function useImageDetail(iid: string | null, enabled = true): UseQueryResult<ImageDetailResponse> {
  return useQuery({
    queryKey: queryKeys.imageDetail(iid ?? "_none_"),
    queryFn: () => endpoints.image(iid!),
    enabled: !!iid && enabled,
  });
}

export function usePatchImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      iid,
      ...d
    }: {
      iid: string;
      is_favorited?: boolean;
      user_note?: string;
      tags?: string[];
      category_id?: string | null;
    }) => endpoints.patchImage(iid, d),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.imageDetail(vars.iid) });
      qc.invalidateQueries({ queryKey: ["images"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useDeleteImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (iid: string) => endpoints.deleteImage(iid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["images"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["trash"] });
    },
  });
}

export function useAddToReferenceLibrary() {
  return useMutation({
    mutationFn: (iid: string) => endpoints.addToReferenceLibrary(iid),
  });
}

/** 分类列表（图片详情面板移动分类用） */
export function useCategoriesForImage(pid: string | null): UseQueryResult<Category[]> {
  return useQuery({
    queryKey: queryKeys.categories(pid ?? "_none_"),
    queryFn: async () => {
      const d = await endpoints.categories(pid!);
      return d.categories ?? [];
    },
    enabled: !!pid,
  });
}
