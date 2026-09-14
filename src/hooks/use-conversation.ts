"use client";

// 对话查询 + batch 轮询 hooks

import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { endpoints } from "@/lib/api-client";
import { queryKeys } from "@/hooks/use-projects";
import { toast } from "sonner";
import type { ConversationRound } from "@/types/entities";

export interface ConversationData {
  conversation: import("@/types/entities").Conversation;
  rounds: ConversationRound[];
}

// ---------------------------------------------------------------------------
// 对话详情
// ---------------------------------------------------------------------------

export function useConversation(cid: string, enabled = true): UseQueryResult<ConversationData> {
  return useQuery({
    queryKey: queryKeys.conversation(cid),
    queryFn: () => endpoints.conversation(cid),
    enabled: !!cid && enabled,
  });
}

// ---------------------------------------------------------------------------
// 分类（供对话页顶部分类选择器）
// ---------------------------------------------------------------------------

export function useCategories(pid: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.categories(pid),
    queryFn: async () => {
      const d = await endpoints.categories(pid);
      return d.categories ?? [];
    },
    enabled: !!pid && enabled,
  });
}

export function useConversations(pid: string, categoryId?: string) {
  return useQuery({
    queryKey: queryKeys.conversations(pid, categoryId),
    queryFn: async () => {
      const d = await endpoints.conversations(pid, categoryId);
      return d.conversations ?? [];
    },
    enabled: !!pid,
  });
}

// ---------------------------------------------------------------------------
// batch 轮询：active 时每 2s refetch，到终态自动停止
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES = new Set(["success", "failed", "unknown"]);

export function usePollBatch(bid: string | null, active: boolean) {
  const qc = useQueryClient();
  const prevStatusRef = useRef<string | null>(null);
  const cidRef = useRef<string | null>(null);

  const query = useQuery({
    queryKey: queryKeys.batch(bid ?? "_none_"),
    queryFn: () => endpoints.batch(bid!),
    enabled: !!bid && active,
    refetchInterval: (query) => {
      const status = query.state.data?.batch?.status;
      if (status && TERMINAL_STATUSES.has(status)) return false;
      return 2000;
    },
  });

  const batch = query.data?.batch ?? null;

  // 终态时：invalidate 对话 + toast 通知
  useEffect(() => {
    if (!batch) return;
    const status = batch.status;
    const prev = prevStatusRef.current;
    if (status && TERMINAL_STATUSES.has(status) && prev === "generating") {
      // 刷新对话与项目数据
      if (cidRef.current) {
        qc.invalidateQueries({ queryKey: queryKeys.conversation(cidRef.current) });
      }
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["images"] });
      qc.invalidateQueries({ queryKey: ["project"] });
      const saved = batch.savedCount ?? 0;
      const target = batch.targetCount ?? "?";
      if (status === "success") {
        toast.success(`生成完成（${saved}/${target}）`);
      } else if (status === "failed") {
        const msg = (query.data?.request?.errorMessage) || "详见对话内记录";
        toast.error(`生成失败：${msg}`, { duration: 5200 });
      } else {
        const reason = query.data?.request?.unknownReason || "无法确认远端结果";
        toast.error(`结果未知：${reason}`, { duration: 5200 });
      }
    }
    prevStatusRef.current = status ?? null;
  }, [batch, qc, query.data]);

  /** 设置轮询的对话 id（终态时用于 invalidate） */
  const setConversationId = (cid: string) => {
    cidRef.current = cid;
  };

  return { ...query, setConversationId };
}

// ---------------------------------------------------------------------------
// 对话 CRUD
// ---------------------------------------------------------------------------

export function usePatchConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ cid, ...d }: { cid: string; title?: string; category_id?: string | null }) =>
      endpoints.patchConversation(cid, d),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.conversation(vars.cid) });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}

export function useDeleteConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cid: string) => endpoints.deleteConversation(cid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["trash"] });
    },
  });
}

export function useMoveConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ cid, ...d }: { cid: string; project_id: string; category_id?: string | null }) =>
      endpoints.moveConversation(cid, d),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: queryKeys.conversation(vars.cid) });
      qc.invalidateQueries({ queryKey: ["project"] });
      qc.invalidateQueries({ queryKey: ["images"] });
      qc.invalidateQueries({ queryKey: ["references"] });
      qc.invalidateQueries({ queryKey: ["trash"] });
      qc.invalidateQueries({ queryKey: ["search"] });
    },
  });
}

export function useCreateConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pid, ...d }: { pid: string; title?: string; category_id?: string | null }) =>
      endpoints.createConversation(pid, d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pid, name }: { pid: string; name: string }) => endpoints.createCategory(pid, { name }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.categories(vars.pid) });
      qc.invalidateQueries({ queryKey: ["project"] });
    },
  });
}
