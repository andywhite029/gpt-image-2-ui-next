"use client";

// 对话视图：顶栏（标题编辑/分类/删除）+ 轮次消息流 + 底部输入区
// 生成中的 batch 用轮询（usePollBatch），完成后 invalidate 对话

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { endpoints, errorText, imageUrl, referenceFileUrl, copyText, type GenerateResponse } from "@/lib/api-client";
import { queryKeys } from "@/hooks/use-projects";
import { useConversation, useCategories, usePollBatch } from "@/hooks/use-conversation";
import { useReferences } from "@/hooks/use-library";
import { useSettings } from "@/hooks/use-settings";
import { useUI } from "@/app/providers";
import { useModal } from "@/components/ui/modal";
import { Loading, ErrorBox } from "@/components/ui/empty";
import { Badge } from "@/components/ui/badge";
import { Lightbox } from "@/components/gallery/lightbox";
import { InputArea } from "./input-area";
import { fmtTime } from "@/lib/format";
import type { ConversationRound, ReferenceSummary } from "@/types/entities";

const HIDDEN_KEY = "gpt_image2_hidden_rounds";
const PROMPT_COLLAPSE_LEN = 160;
const PROMPT_COLLAPSE_LINES = 6;

function readHiddenMap(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export default function ConversationPage({
  params,
}: {
  params: Promise<{ pid: string; cid: string }>;
}) {
  const { pid, cid } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const modal = useModal();
  const { settings } = useSettings();
  const { setConversationGenerating } = useUI();
  const { data, isLoading, error } = useConversation(cid);
  const { data: categories = [] } = useCategories(pid);
  const { data: libRefs = [] } = useReferences(pid);

  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [expandedPrompts, setExpandedPrompts] = useState<Set<string>>(new Set());
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [lightboxSiblings, setLightboxSiblings] = useState<string[]>([]);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [retrying, setRetrying] = useState<Set<string>>(new Set());

  const streamRef = useRef<HTMLDivElement>(null);
  const userNearBottomRef = useRef(true);
  const didAutoScrollRef = useRef(false);

  const conversation = data?.conversation ?? null;
  const rounds = useMemo(() => data?.rounds ?? [], [data]);

  // 生成中的 batch ids
  const generatingBatchIds = useMemo(
    () => rounds.filter((r) => r.batch?.status === "generating").map((r) => r.batch!.id),
    [rounds]
  );
  const primaryBatchId = generatingBatchIds[0] ?? null;
  const hasGenerating = generatingBatchIds.length > 0;

  // 通知全局「生成中」状态
  useEffect(() => {
    setConversationGenerating(cid, hasGenerating);
    return () => setConversationGenerating(cid, false);
  }, [cid, hasGenerating, setConversationGenerating]);

  // 初始加载隐藏轮次
  useEffect(() => {
    const map = readHiddenMap();
    setHiddenIds(new Set(map[cid] ?? []));
  }, [cid]);

  // 自动滚动到底部（首次强制；之后仅当用户在底部附近）
  useEffect(() => {
    const el = streamRef.current;
    if (!el) return;
    const force = !didAutoScrollRef.current;
    if (force || userNearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      didAutoScrollRef.current = true;
    }
  }, [rounds]);

  const onStreamScroll = () => {
    const el = streamRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    userNearBottomRef.current = gap < 80;
  };

  const refreshConversation = useCallback(() => {
    qc.invalidateQueries({ queryKey: queryKeys.conversation(cid) });
    qc.invalidateQueries({ queryKey: ["conversations"] });
    qc.invalidateQueries({ queryKey: ["projects"] });
  }, [qc, cid]);

  // -----------------------------------------------------------------------
  // 生成轮询：任一生成中 batch 存在时轮询第一个，终态时刷新对话
  // -----------------------------------------------------------------------
  const poll = usePollBatch(primaryBatchId, hasGenerating);
  useEffect(() => {
    poll.setConversationId(cid);
  }, [poll, cid]);

  // 轮询期间定期刷新对话（简单方案：轮询查询变化时 invalidate）
  const pollStatus = poll.data?.batch?.status;
  useEffect(() => {
    if (pollStatus && pollStatus !== "generating") {
      refreshConversation();
    }
  }, [pollStatus, refreshConversation]);

  // -----------------------------------------------------------------------
  // 操作
  // -----------------------------------------------------------------------

  const commitTitle = async (save: boolean) => {
    setEditingTitle(false);
    const title = titleDraft.trim();
    if (!save || !title || title === (conversation?.title ?? "")) return;
    try {
      await endpoints.patchConversation(cid, { title });
      toast.success("标题已更新");
      refreshConversation();
    } catch (e) {
      toast.error("标题更新失败：" + errorText(e));
    }
  };

  const onCategoryChange = async (value: string) => {
    const categoryId = value || null;
    try {
      await endpoints.patchConversation(cid, { category_id: categoryId });
      toast.success(categoryId ? "已移动分类" : "已设为未分类");
      refreshConversation();
    } catch (e) {
      toast.error("移动分类失败：" + errorText(e));
    }
  };

  const onDeleteConversation = async () => {
    const ok = await modal.confirmModal({
      title: "删除对话",
      message: `删除对话「${conversation?.title ?? "该对话"}」将移入回收站（可恢复）。确定删除吗？`,
      danger: true,
      confirmText: "移入回收站",
    });
    if (!ok) return;
    try {
      await endpoints.deleteConversation(cid);
      toast.success("对话已移入回收站");
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      router.push(`/projects/${pid}`);
    } catch (e) {
      toast.error("删除失败：" + errorText(e));
    }
  };

  const onSubmitted = useCallback(
    (res: GenerateResponse) => {
      // 立即刷新对话（新轮次出现），轮询由 generatingBatchIds 驱动
      refreshConversation();
      const bid = res.batch?.id;
      if (bid) {
        qc.invalidateQueries({ queryKey: queryKeys.batch(bid) });
      }
      // 强制滚到底部
      requestAnimationFrame(() => {
        const el = streamRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    },
    [refreshConversation, qc]
  );

  const retryRequest = async (rid: string, needConfirm = false) => {
    if (needConfirm) {
      const ok = await modal.confirmModal({
        title: "重试",
        message: "该批次结果未知，重试将按原参数重新发起生成，可能产生重复消耗。确定重试吗？",
        danger: true,
        confirmText: "重试",
      });
      if (!ok) return;
    }
    const apiKey = (settings.apiKey || "").trim();
    if (!apiKey) {
      toast.error("请先在右上角「设置」里填写 API Key");
      return;
    }
    setRetrying((prev) => new Set(prev).add(rid));
    try {
      await endpoints.retry(rid, {
        api_key: apiKey,
        base_url: settings.baseUrl || "",
        model: settings.model || "gpt-image-2",
      });
      toast.success("已重新提交生成");
      refreshConversation();
    } catch (e) {
      toast.error("重试失败：" + errorText(e));
    } finally {
      setRetrying((prev) => {
        const next = new Set(prev);
        next.delete(rid);
        return next;
      });
    }
  };

  const editRetryRequest = async (rid: string) => {
    try {
      const payload = await endpoints.editRetry(rid);
      sessionStorage.setItem("gpt_image2_prefill", JSON.stringify(payload));
      toast.success("已填回输入区，可修改后重新生成");
      // 重新挂载 input-area 消费预填（用 key 强制刷新）
      window.dispatchEvent(new CustomEvent("prefill-input"));
      // 简单做法：刷新本页
      setPrefillTick((v) => v + 1);
    } catch (e) {
      toast.error("获取原始参数失败：" + errorText(e));
    }
  };

  const [prefillTick, setPrefillTick] = useState(0);

  const completeBatch = async (bid: string) => {
    const apiKey = (settings.apiKey || "").trim();
    if (!apiKey) {
      toast.error("请先在右上角「设置」里填写 API Key");
      return;
    }
    try {
      await endpoints.complete(bid, {
        api_key: apiKey,
        base_url: settings.baseUrl || "",
        model: settings.model || "gpt-image-2",
      });
      toast.success("已提交补齐生成");
      refreshConversation();
    } catch (e) {
      toast.error("补齐失败：" + errorText(e));
    }
  };

  const hideRound = (rid: string) => {
    const next = new Set(hiddenIds).add(rid);
    setHiddenIds(next);
    const map = readHiddenMap();
    map[cid] = Array.from(next);
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(map));
    toast.success("已隐藏该轮（仅影响本机显示，数据仍保留）");
  };

  const showHiddenRounds = () => {
    setHiddenIds(new Set());
    const map = readHiddenMap();
    delete map[cid];
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(map));
  };

  // -----------------------------------------------------------------------
  // 渲染
  // -----------------------------------------------------------------------

  const visibleRounds = rounds.filter((r) => r.request && !hiddenIds.has(r.request.id));
  const refMap = useMemo(() => new Map(libRefs.map((r) => [r.id, r])), [libRefs]);

  if (isLoading) return <Loading text="加载对话…" />;
  if (error || !conversation) {
    return (
      <ErrorBox message={"对话加载失败：" + (error ? errorText(error) : "对话不存在")}>
        <button type="button" className="btn-ghost btn-ghost-sm mt-2" onClick={() => router.push(`/projects/${pid}`)}>
          返回项目
        </button>
      </ErrorBox>
    );
  }

  const allImageIds = rounds.flatMap((r) => r.images.map((i) => i.id));

  return (
    <div className="-m-5 flex h-full flex-col max-[900px]:-m-3.5">
      {/* 顶栏 */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-panel px-4 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {editingTitle ? (
            <input
              type="text"
              className="input-text min-w-[120px] max-w-[46vw] flex-1 border-accent"
              value={titleDraft}
              autoFocus
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitTitle(true);
                else if (e.key === "Escape") commitTitle(false);
              }}
              onBlur={() => commitTitle(true)}
            />
          ) : (
            <>
              <span className="max-w-[46vw] truncate text-[15px] font-semibold">
                {conversation.title || "对话"}
              </span>
              <button
                type="button"
                title="修改标题"
                aria-label="修改对话标题"
                className="flex size-[26px] shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border bg-panel2 text-[13px] text-muted hover:border-accent hover:text-text"
                onClick={() => {
                  setTitleDraft(conversation.title ?? "");
                  setEditingTitle(true);
                }}
              >
                ✎
              </button>
            </>
          )}
        </div>
        <select
          className="input-select w-auto max-w-[180px]"
          aria-label="移动分类"
          value={conversation.categoryId ?? ""}
          onChange={(e) => onCategoryChange(e.target.value)}
        >
          <option value="">未分类</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="cursor-pointer rounded-lg border border-[rgba(245,63,63,0.4)] bg-transparent px-3 py-1.5 text-[13px] text-err hover:bg-[rgba(245,63,63,0.12)]"
          onClick={onDeleteConversation}
        >
          删除对话
        </button>
      </div>

      {/* 消息流 */}
      <div
        ref={streamRef}
        onScroll={onStreamScroll}
        tabIndex={0}
        className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-4"
      >
        {hiddenIds.size > 0 && (
          <button
            type="button"
            className="self-center cursor-pointer rounded-lg border border-dashed border-border bg-transparent px-3 py-1.5 text-xs text-muted hover:border-accent hover:text-text"
            onClick={showHiddenRounds}
          >
            已隐藏 {hiddenIds.size} 轮 · 点击恢复显示
          </button>
        )}

        {!visibleRounds.length ? (
          <div className="rounded-xl border-2 border-dashed border-border p-10 text-center text-sm leading-relaxed text-muted">
            {hiddenIds.size > 0 ? "所有轮次均已隐藏" : "还没有生成记录，在下方输入 Prompt 开始创作"}
          </div>
        ) : (
          visibleRounds.map((round) => (
            <RoundCard
              key={round.request.id}
              round={round}
              refMap={refMap}
              expandedPrompts={expandedPrompts}
              onTogglePrompt={(rid) =>
                setExpandedPrompts((prev) => {
                  const next = new Set(prev);
                  if (next.has(rid)) next.delete(rid);
                  else next.add(rid);
                  return next;
                })
              }
              onOpenImage={(id, siblings) => {
                setLightboxSiblings(siblings);
                setLightboxId(id);
              }}
              onRetry={retryRequest}
              onEditRetry={editRetryRequest}
              onComplete={completeBatch}
              onHide={hideRound}
              retrying={retrying.has(round.request.id)}
              onGoProject={() => router.push(`/projects/${pid}`)}
            />
          ))
        )}
      </div>

      {/* 输入区 */}
      <div className="shrink-0">
        <InputArea
          key={prefillTick}
          pid={pid}
          cid={cid}
          conversation={conversation}
          onSubmitted={onSubmitted}
          busy={hasGenerating}
        />
      </div>

      {/* Lightbox */}
      {lightboxId && (
        <Lightbox
          imageId={lightboxId}
          siblingIds={lightboxSiblings.length ? lightboxSiblings : allImageIds}
          onClose={() => setLightboxId(null)}
          onOpenImage={setLightboxId}
          onGoConversation={(p, c) => router.push(`/projects/${p}/conversation/${c}`)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 轮次卡片
// ---------------------------------------------------------------------------

function RoundCard({
  round,
  refMap,
  expandedPrompts,
  onTogglePrompt,
  onOpenImage,
  onRetry,
  onEditRetry,
  onComplete,
  onHide,
  retrying,
  onGoProject,
}: {
  round: ConversationRound;
  refMap: Map<string, ReferenceSummary>;
  expandedPrompts: Set<string>;
  onTogglePrompt: (rid: string) => void;
  onOpenImage: (id: string, siblings: string[]) => void;
  onRetry: (rid: string, needConfirm?: boolean) => Promise<void>;
  onEditRetry: (rid: string) => Promise<void>;
  onComplete: (bid: string) => Promise<void>;
  onHide: (rid: string) => void;
  retrying: boolean;
  onGoProject: () => void;
}) {
  const req = round.request;
  const batch = round.batch;
  const images = round.images ?? [];
  const status = batch?.status ?? "generating";
  const params = (req.parameters ?? {}) as Record<string, unknown>;
  const sizeVal = (params.size as string) ?? req.requestSnapshot?.size ?? "";
  const nVal = params.n != null ? params.n : req.requestSnapshot?.n;
  const qualityVal =
    (params.quality_user_choice as string) ?? (params.quality_effective as string) ?? null;
  const refIds = req.referenceAssetIds ?? [];

  const promptText = req.promptOriginal || req.promptEffective || "";
  const negText = req.negativePromptOriginal || req.negativePromptEffective;
  const needCollapse =
    promptText.length > PROMPT_COLLAPSE_LEN || promptText.split("\n").length > PROMPT_COLLAPSE_LINES;
  const expanded = expandedPrompts.has(req.id);

  // partial: failed 但有保存成功的图
  const isPartial = status === "failed" && (batch?.savedCount ?? 0) > 0;
  const badgeStatus = isPartial ? "partial" : status;
  const badgeLabel =
    status === "generating"
      ? `生成中 · 目标 ${batch?.targetCount ?? "?"} / 已提交 ${batch?.targetCount ?? "?"} / 已完成 ${batch?.returnedCount ?? 0} / 成功保存 ${batch?.savedCount ?? 0}`
      : status === "success"
        ? `生成成功 · 共 ${batch?.savedCount ?? images.length} 张`
        : isPartial
          ? batch?.isCompleted
            ? `失败（已补齐）· 已保存 ${batch?.savedCount}/${batch?.targetCount} 张`
            : `部分成功 · 已保存 ${batch?.savedCount}/${batch?.targetCount} 张`
          : status === "failed"
            ? "生成失败（无图可存）"
            : `结果未知 · ${req.unknownReason || "服务重启或网络中断，无法确认远端是否已生成结果"}（重试可能产生重复消耗）`;

  const errorDetailsText = (() => {
    const parts: string[] = [];
    if (req.errorMessage) parts.push(String(req.errorMessage));
    const details = batch?.errorDetails;
    if (Array.isArray(details)) {
      details.forEach((d, i) => {
        if (typeof d === "string") parts.push(`${i + 1}. ${d}`);
        else if (d && typeof d === "object") {
          const idx = d.index != null ? `第 ${d.index + 1} 张` : `第 ${i + 1} 条`;
          const msg = d.error || JSON.stringify(d);
          parts.push(`${idx}：${msg}`);
        } else parts.push(`${i + 1}. ${String(d)}`);
      });
    }
    return parts.join("\n");
  })();

  const onCopyPrompt = async () => {
    const text = req.promptOriginal || req.promptEffective || "";
    if (!text) {
      toast.error("该轮没有可复制的 Prompt");
      return;
    }
    const ok = await copyText(text);
    if (ok) toast.success("已复制 Prompt");
    else toast.error("复制失败，请手动选择复制");
  };

  return (
    <div className="rounded-xl border border-border bg-panel px-4 py-3.5">
      {/* 头部：时间 + badge */}
      <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
        <span className="text-xs text-muted">{fmtTime(req.createdAt || batch?.createdAt)}</span>
        <div className="flex flex-wrap gap-1.5">
          {req.retryOfRequestId && (
            <span className="rounded-md border border-[rgba(0,158,250,0.4)] px-2 py-0.5 text-[11px] text-accent">
              重试
            </span>
          )}
          {(req.completionForBatchId || batch?.isCompletion) && (
            <span className="rounded-md border border-[rgba(138,92,255,0.4)] px-2 py-0.5 text-[11px] text-unknown">
              补齐
            </span>
          )}
          {batch?.isCompleted && (
            <span className="rounded-md border border-[rgba(138,92,255,0.4)] px-2 py-0.5 text-[11px] text-unknown">
              已补齐达标
            </span>
          )}
        </div>
        <div className="ml-auto">
          <Badge status={badgeStatus as "generating" | "success" | "failed" | "partial" | "unknown"} label={badgeLabel} />
        </div>
      </div>

      {/* Prompt（折叠） */}
      {promptText && (
        <>
          <div
            className={
              "text-sm leading-relaxed whitespace-pre-wrap break-words text-text " +
              (needCollapse && !expanded ? "max-h-[8.2em] overflow-hidden" : "")
            }
          >
            {promptText}
          </div>
          {needCollapse && (
            <button
              type="button"
              className="mt-0.5 cursor-pointer border-none bg-transparent px-0 text-xs text-accent"
              onClick={() => onTogglePrompt(req.id)}
            >
              {expanded ? "收起 ▴" : "展开全部 ▾"}
            </button>
          )}
        </>
      )}

      {/* 负面 Prompt */}
      {negText && (
        <div className="mt-2 text-xs leading-relaxed whitespace-pre-wrap break-words text-muted">
          <b className="font-semibold text-text">负面 Prompt：</b>
          {negText}
        </div>
      )}

      {/* 参数行 */}
      <div className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted">
        {sizeVal && (
          <span>
            <b className="font-medium text-text">尺寸 </b>
            {sizeVal}
          </span>
        )}
        {nVal != null && (
          <span>
            <b className="font-medium text-text">数量 </b>
            {String(nVal)} 张
          </span>
        )}
        {qualityVal && (
          <span>
            <b className="font-medium text-text">质量 </b>
            {qualityVal}
          </span>
        )}
        {refIds.length > 0 && (
          <span>
            <b className="font-medium text-text">参考图 </b>
            {refIds.length} 张
          </span>
        )}
        {params.model ? (
          <span>
            <b className="font-medium text-text">模型 </b>
            {String(params.model)}
          </span>
        ) : null}
      </div>

      {/* 参考图缩略条 */}
      {refIds.length > 0 && (
        <div className="mt-2.5 flex gap-2 overflow-x-auto p-0.5">
          {refIds.map((rid) => {
            const ref = refMap.get(rid);
            return ref && !ref.fileMissing ? (
              <button
                key={rid}
                type="button"
                title={ref.name || rid}
                className="size-14 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-border bg-panel2 transition-colors hover:border-accent"
                onClick={() => window.open(referenceFileUrl(rid), "_blank", "noopener")}
              >
                <img
                  src={referenceFileUrl(rid)}
                  alt={ref.name || "参考图"}
                  loading="lazy"
                  className="size-full object-cover"
                />
              </button>
            ) : (
              <span
                key={rid}
                title="参考图记录缺失或已删除"
                className="flex size-14 shrink-0 items-center justify-center rounded-lg border border-border bg-panel2 p-1 text-center text-[10px] leading-tight text-muted"
              >
                参考图不可用
              </span>
            );
          })}
        </div>
      )}

      {/* 失败/未知状态详情 + 操作 */}
      {(status === "failed" || status === "unknown") && (
        <div
          className={
            "mt-3 rounded-lg border px-3 py-2.5 text-[13px] leading-relaxed " +
            (status === "failed"
              ? "border-[rgba(245,63,63,0.4)] bg-[rgba(245,63,63,0.1)] text-err"
              : "border-[rgba(138,92,255,0.4)] bg-[rgba(138,92,255,0.1)] text-unknown")
          }
        >
          {status === "failed" && !isPartial && (
            <div className="whitespace-pre-wrap break-words">
              {req.errorMessage || (errorDetailsText ? "详见错误明细" : "未知错误")}
            </div>
          )}
          {errorDetailsText && (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-muted">错误明细</summary>
              <pre className="mt-1.5 rounded-lg bg-black/30 px-2.5 py-2 text-[11px] leading-relaxed whitespace-pre-wrap break-words text-muted">
                {errorDetailsText}
              </pre>
            </details>
          )}
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-ghost btn-ghost-sm"
              disabled={retrying}
              onClick={() => onRetry(req.id, status === "unknown")}
            >
              重试
            </button>
            <button type="button" className="btn-ghost btn-ghost-sm" onClick={() => onEditRetry(req.id)}>
              编辑后重试
            </button>
            {status === "failed" && <button type="button" className="btn-ghost btn-ghost-sm" onClick={onCopyPrompt}>复制 Prompt</button>}
            <button
              type="button"
              className="btn-ghost btn-ghost-sm hover:border-err hover:text-err"
              onClick={() => onHide(req.id)}
            >
              隐藏
            </button>
          </div>
        </div>
      )}

      {/* partial：补齐按钮 */}
      {isPartial && !batch?.isCompleted && (batch?.savedCount ?? 0) < (batch?.targetCount ?? 0) && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button type="button" className="btn-ghost btn-ghost-sm" onClick={() => onComplete(batch!.id)}>
            补齐缺失
          </button>
          {errorDetailsText && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted">错误明细</summary>
              <pre className="mt-1.5 rounded-lg bg-black/30 px-2.5 py-2 text-[11px] leading-relaxed whitespace-pre-wrap break-words text-muted">
                {errorDetailsText}
              </pre>
            </details>
          )}
        </div>
      )}

      {/* 图片结果网格 */}
      {images.length > 0 && (
        <div className="mt-3 grid auto-flow-dense grid-cols-[repeat(auto-fill,minmax(150px,1fr))] items-start gap-2.5">
          {images.map((img) =>
            img.fileMissing ? (
              <div
                key={img.id}
                title={img.id}
                className="flex min-h-[80px] items-center justify-center rounded-lg border border-border bg-panel2 p-2.5 text-center text-xs text-muted"
              >
                图片文件缺失
              </div>
            ) : (
              <ResultImage
                key={img.id}
                image={img}
                siblings={images.map((i) => i.id)}
                onOpen={onOpenImage}
              />
            )
          )}
        </div>
      )}

      {/* success 状态操作 */}
      {status === "success" && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button type="button" className="btn-ghost btn-ghost-sm" onClick={onCopyPrompt}>
            复制 Prompt
          </button>
          <button
            type="button"
            className="btn-ghost btn-ghost-sm hover:border-err hover:text-err"
            onClick={() => onHide(req.id)}
          >
            隐藏
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 结果图（按宽高比跨列）
// ---------------------------------------------------------------------------

function ResultImage({
  image,
  siblings,
  onOpen,
}: {
  image: import("@/types/entities").ImageSummary;
  siblings: string[];
  onOpen: (id: string, siblings: string[]) => void;
}) {
  const [span, setSpan] = useState<"" | "wide" | "tall">("");
  return (
    <button
      type="button"
      title="查看图片详情"
      onClick={() => onOpen(image.id, siblings)}
      className={
        "cursor-pointer overflow-hidden rounded-lg border border-border bg-panel2 text-left transition-colors hover:border-accent " +
        (span === "wide" ? "col-span-3" : span === "tall" ? "col-span-2" : "col-span-1")
      }
    >
      <img
        src={image.thumbnailUrl ?? imageUrl.thumbnail(image.id)}
        alt="生成结果"
        loading="lazy"
        className="block h-auto w-full bg-black"
        onLoad={(e) => {
          const img = e.currentTarget;
          if (!img.naturalWidth || !img.naturalHeight) return;
          const ratio = img.naturalWidth / img.naturalHeight;
          if (ratio >= 1.2) setSpan("wide");
          else if (ratio < 0.8) setSpan("tall");
        }}
      />
    </button>
  );
}
