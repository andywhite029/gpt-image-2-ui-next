"use client";

// 生成输入区：prompt/negative、参考图弹窗（4 tab）、比例+分辨率联动、数量、质量、分类、已选参考条

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  endpoints,
  errorText,
  imageThumbUrl,
  referenceFileUrl,
  type GenerateResponse,
} from "@/lib/api-client";
import { queryKeys, useConfig } from "@/hooks/use-projects";
import { useCategories } from "@/hooks/use-conversation";
import { useImages } from "@/hooks/use-images";
import { useReferences, useUploadReferences } from "@/hooks/use-library";
import { useSettings } from "@/hooks/use-settings";
import { useModal } from "@/components/ui/modal";
import { useUI } from "@/app/providers";
import type { Conversation, ImageSummary, ReferenceSummary } from "@/types/entities";

const DEFAULT_CAPS = {
  supported_sizes: [{ size: "1024x1024", ratio: "1:1" }],
  supports_quality: false,
  quality_options: [] as string[],
  supports_negative_prompt: false,
  max_reference_images: 16,
};

interface SelectedRef {
  id: string;
  url: string;
  name: string;
  source: "ref" | "img";
}

export interface InputAreaProps {
  pid: string;
  cid: string;
  conversation: Conversation;
  /** 生成提交后回调（父组件负责 invalidate / toast） */
  onSubmitted?: (res: GenerateResponse) => void;
  /** 会话内是否生成中（禁用提交） */
  busy: boolean;
}

export function InputArea({ pid, cid, conversation, onSubmitted, busy }: InputAreaProps) {
  const modal = useModal();
  const qc = useQueryClient();
  const { setSettingsOpen } = useUI();
  const { settings, update } = useSettings();
  const { data: config } = useConfig();
  const { data: categories = [] } = useCategories(pid);

  // ---- 表单状态 ----
  const [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState("");
  const [selected, setSelected] = useState<SelectedRef[]>([]);
  const [ratio, setRatio] = useState<string | null>(null);
  const [size, setSize] = useState<string | null>(null);
  const [n, setN] = useState(1);
  const [quality, setQuality] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string>(conversation.categoryId ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [popupOpen, setPopupOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"upload" | "paste" | "history" | "library">("upload");

  const promptRef = useRef<HTMLTextAreaElement>(null);
  const pasteZoneRef = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // ---- capabilities ----
  const caps = useMemo(() => {
    const model = settings.model || config?.model || "gpt-image-2";
    return config?.capabilities?.[model] ?? DEFAULT_CAPS;
  }, [config, settings.model]);
  const maxRefs = caps.max_reference_images || 16;

  // ---- 比例/分辨率联动 ----
  const sizes = caps.supported_sizes?.length ? caps.supported_sizes : DEFAULT_CAPS.supported_sizes;
  const ratios = useMemo(() => {
    const seen: string[] = [];
    for (const item of sizes) {
      if (item.ratio && !seen.includes(item.ratio)) seen.push(item.ratio);
    }
    return seen.length ? seen : ["1:1"];
  }, [sizes]);

  const sizesOfRatio = useCallback(
    (r: string) => sizes.filter((item) => item.ratio === r && item.size),
    [sizes]
  );

  // 初始化 ratio/size：记忆上次尺寸 → 首个比例首个尺寸
  useEffect(() => {
    const last = settings.lastSize;
    if (last) {
      const hit = sizes.find((s) => s.size === last);
      if (hit) {
        setRatio(hit.ratio);
        setSize(hit.size);
        return;
      }
    }
    setRatio(ratios[0] ?? "1:1");
    setSize(sizesOfRatio(ratios[0] ?? "1:1")[0]?.size ?? "1024x1024");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  // ratio 变化时修正 size
  useEffect(() => {
    if (!ratio) return;
    const opts = sizesOfRatio(ratio);
    if (!opts.length) return;
    if (!size || !opts.some((s) => s.size === size)) {
      setSize(opts[0]?.size ?? "1024x1024");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratio]);

  // 质量初始化
  useEffect(() => {
    if (caps.supports_quality && caps.quality_options?.length) {
      setQuality((q) => (q && caps.quality_options.includes(q) ? q : String(caps.quality_options[0])));
    } else {
      setQuality(null);
    }
  }, [caps]);

  // ---- 消费 sessionStorage 预填（模板应用 / lightbox 继续修改 / 编辑重试） ----
  useEffect(() => {
    const raw = sessionStorage.getItem("gpt_image2_prefill");
    if (!raw) return;
    sessionStorage.removeItem("gpt_image2_prefill");
    try {
      const payload = JSON.parse(raw) as Record<string, unknown>;
      if (typeof payload.prompt === "string" && payload.prompt) setPrompt(payload.prompt);
      if (caps.supports_negative_prompt && typeof payload.negative_prompt === "string") {
        setNegative(payload.negative_prompt);
      }
      const sizeVal = payload.size as string | undefined;
      if (sizeVal) {
        const hit = sizes.find((s) => s.size === sizeVal);
        if (hit) {
          setRatio(hit.ratio);
          setSize(hit.size);
        }
      }
      const nVal = payload.n != null ? Number(payload.n) : null;
      if (nVal && [1, 2, 4].includes(nVal)) setN(nVal);
      const qVal = payload.quality as string | undefined;
      if (qVal && caps.quality_options?.includes(qVal)) setQuality(qVal);
      // 参考图（含 extra_image_id）
      const ids = Array.isArray(payload.reference_ids) ? (payload.reference_ids as string[]) : [];
      const extra = (payload.extra_image_id ?? payload.image_id ?? payload.add_image_id) as string | undefined;
      const all = extra ? [...ids, extra] : ids;
      if (all.length) resolveRefs(all);
      toast.success("已应用参数到输入区");
    } catch {
      /* 忽略损坏的预填数据 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  // ---- 参考图解析（id → SelectedRef） ----
  const { data: historyData } = useImages(pid, { limit: 200 }, popupOpen || false);
  const { data: libRefs = [] } = useReferences(pid, popupOpen);
  const historyImages = historyData?.items ?? [];

  const resolveRefs = useCallback(
    async (ids: string[]) => {
      const result: SelectedRef[] = [];
      for (const id of ids) {
        if (typeof id !== "string") continue;
        if (id.startsWith("ref_")) {
          const r = libRefs.find((x) => x.id === id);
          result.push({
            id,
            url: r ? referenceFileUrl(id) : `/api/references/${id}/file`,
            name: r?.name ?? "参考图",
            source: "ref",
          });
        } else {
          const it = historyImages.find((x) => x.id === id);
          result.push({
            id,
            url: it ? imageThumbUrl(it) : `/api/images/${id}/file`,
            name: it ? "历史图片 " + id.slice(0, 8) : "历史图片",
            source: "img",
          });
        }
      }
      setSelected((prev) => {
        const next = [...prev];
        for (const item of result) {
          if (next.some((s) => s.id === item.id)) continue;
          if (next.length >= maxRefs) break;
          next.push(item);
        }
        return next;
      });
    },
    [libRefs, historyImages, maxRefs]
  );

  // ---- 上传 ----
  const uploadMutation = useUploadReferences(pid);

  const uploadFiles = async (files: File[]) => {
    const { ok, bad } = validateFiles(files);
    if (bad.length) {
      toast.error(`已跳过 ${bad.length} 张：${bad.slice(0, 3).join("；")}${bad.length > 3 ? " 等" : ""}`);
    }
    if (!ok.length) return;
    const room = maxRefs - selected.length;
    if (room <= 0) {
      toast.error(`参考图已达上限 ${maxRefs} 张，请先移除部分参考图`);
      return;
    }
    if (ok.length > room) {
      toast.error(`最多再添加 ${room} 张参考图（已达 ${maxRefs} 张上限）`);
      return;
    }
    try {
      const res = await uploadMutation.mutateAsync(ok);
      const list = res.references ?? [];
      setSelected((prev) => {
        const next = [...prev];
        for (const r of list) {
          if (next.some((s) => s.id === r.id)) continue;
          if (next.length >= maxRefs) break;
          next.push({
            id: r.id,
            url: referenceFileUrl(r.id),
            name: r.name || "参考图",
            source: "ref",
          });
        }
        return next;
      });
      toast.success(`已添加 ${list.length} 张参考图`);
    } catch (e) {
      toast.error("参考图上传失败：" + errorText(e));
    }
  };

  const validateFiles = (files: File[]) => {
    const maxMb = 25;
    const allowed = ["image/png", "image/jpeg", "image/webp"];
    const ok: File[] = [];
    const bad: string[] = [];
    for (const f of files) {
      let mime = f.type;
      if (!mime) {
        const ext = (f.name.split(".").pop() ?? "").toLowerCase();
        mime = { png: "image/png", jpeg: "image/jpeg", jpg: "image/jpeg", webp: "image/webp" }[ext] ?? "";
      }
      if (mime === "image/jpg") mime = "image/jpeg";
      if (!allowed.includes(mime)) {
        bad.push(`${f.name}（格式不支持）`);
        continue;
      }
      if (f.size > maxMb * 1024 * 1024) {
        bad.push(`${f.name}（超过 ${maxMb} MB）`);
        continue;
      }
      ok.push(f);
    }
    return { ok, bad };
  };

  // 粘贴事件（弹窗打开时）
  useEffect(() => {
    if (!popupOpen) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items ?? [];
      const files: File[] = [];
      for (const item of items) {
        if (item.kind === "file" && item.type?.startsWith("image/")) {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) {
        e.preventDefault();
        uploadFiles(files);
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popupOpen, selected.length]);

  // ---- 插入名称到 Prompt ----
  const insertAtCursor = (text: string) => {
    const ta = promptRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(end);
    const lead = before && !/\s$/.test(before) ? " " : "";
    const inserted = lead + text + " ";
    setPrompt(before + inserted + after);
    requestAnimationFrame(() => {
      const pos = (before + inserted).length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  };

  // ---- 重命名参考图 ----
  const renameReference = async (item: SelectedRef) => {
    const name = await modal.promptModal({
      title: "重命名参考图",
      label: "名称（不改文件名）",
      value: item.name,
    });
    if (name === null || !name.trim()) return;
    const newName = name.trim();
    if (newName === item.name) return;
    try {
      await endpoints.patchReference(item.id, { name: newName });
      setSelected((prev) => prev.map((s) => (s.id === item.id ? { ...s, name: newName } : s)));
      qc.invalidateQueries({ queryKey: ["references"] });
      toast.success(`参考图已重命名为「${newName}」`);
    } catch (e) {
      toast.error("重命名失败：" + errorText(e));
    }
  };

  // ---- 提交 ----
  const submit = async () => {
    if (submitting || busy) return;
    const promptTrim = prompt.trim();
    if (!promptTrim) {
      toast.error("请输入 Prompt");
      promptRef.current?.focus();
      return;
    }
    const apiKey = (settings.apiKey || "").trim();
    if (!apiKey) {
      toast.error("请先在右上角「设置」里填写 API Key");
      setSettingsOpen(true);
      return;
    }
    // 记忆本次尺寸
    update({ lastSize: size ?? "" });

    const clientRequestId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : "crid-" + Date.now() + "-" + Math.random().toString(16).slice(2);

    setSubmitting(true);
    try {
      const res = await endpoints.generate(pid, cid, {
        api_key: apiKey,
        prompt: promptTrim,
        negative_prompt: caps.supports_negative_prompt ? negative.trim() || null : null,
        size: size ?? "1024x1024",
        n,
        quality: caps.supports_quality && quality ? quality : null,
        model: settings.model || "gpt-image-2",
        base_url: settings.baseUrl || "",
        reference_ids: selected.map((s) => s.id),
        category_id: categoryId || null,
        client_request_id: clientRequestId,
      });
      toast.success("已提交生成");
      onSubmitted?.(res);
    } catch (e) {
      const err = e as { code?: string; status?: number };
      if (err.code === "CONVERSATION_BUSY" || err.status === 409) {
        toast.error("该对话正在生成中");
      } else {
        toast.error("提交失败：" + errorText(e));
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Ctrl+Enter 提交
  const onPromptKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  // ---- 清空 ----
  const clearInput = () => {
    setPrompt("");
    setNegative("");
    setSelected([]);
    setN(1);
    setQuality(caps.supports_quality && caps.quality_options?.length ? String(caps.quality_options[0]) : null);
    promptRef.current?.focus();
  };

  // ---- 存为模板 ----
  const saveAsTemplate = () => {
    const p = prompt.trim();
    if (!p) {
      toast.error("请先填写 Prompt 再存为模板");
      return;
    }
    modal.openModal({
      title: "存为 Prompt 模板",
      body: (
        <form id="save-template-form">
          <div className="field">
            <label className="field-label">模板名称</label>
            <input
              type="text"
              name="name"
              className="input-text"
              defaultValue={p.slice(0, 12)}
              autoFocus
            />
          </div>
        </form>
      ),
      actions: [
        { label: "取消", kind: "ghost" },
        {
          label: "保存",
          kind: "primary",
          onClick: async () => {
            const form = document.getElementById("save-template-form") as HTMLFormElement | null;
            if (!form) return false;
            const name = String(new FormData(form).get("name") ?? "").trim();
            if (!name) {
              toast.error("请输入模板名称");
              return false;
            }
            try {
              await endpoints.createTemplate({ name, prompt: p });
              toast.success(`模板「${name}」已保存`);
              qc.invalidateQueries({ queryKey: queryKeys.templates });
              return true;
            } catch (e) {
              toast.error("保存模板失败：" + errorText(e));
              return false;
            }
          },
        },
      ],
    });
  };

  const isBusy = submitting || busy;

  return (
    <div className="relative border-t border-border bg-panel px-4 pt-3 pb-3.5">
      {/* 参考图弹窗（4 tab） */}
      {popupOpen && (
        <div className="absolute right-0 bottom-full left-0 z-30 mb-2 overflow-hidden rounded-xl border border-border bg-panel shadow-[0_-12px_48px_rgba(0,0,0,0.5)]">
          <div className="flex flex-wrap items-center gap-3.5 border-b border-border px-3.5 py-2.5">
            <span className="text-[13px] font-semibold">添加参考图</span>
            <div className="flex flex-1 flex-wrap gap-1">
              {(
                [
                  ["upload", "本地上传"],
                  ["paste", "粘贴/拖拽"],
                  ["history", "历史图片"],
                  ["library", "参考图库"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={
                    "cursor-pointer rounded-lg border px-3 py-1.5 text-xs " +
                    (activeTab === key
                      ? "border-border bg-panel2 text-text"
                      : "border-transparent bg-transparent text-muted")
                  }
                  onClick={() => setActiveTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              aria-label="关闭"
              className="flex size-7 cursor-pointer items-center justify-center rounded-lg border border-border bg-panel2 text-base text-muted hover:text-text"
              onClick={() => setPopupOpen(false)}
            >
              ×
            </button>
          </div>
          <div className="max-h-[320px] overflow-y-auto p-3.5">
            {activeTab === "upload" && (
              <div>
                <input
                  type="file"
                  className="input-text"
                  multiple
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => {
                    const files = e.target.files;
                    if (files?.length) uploadFiles(Array.from(files));
                    e.target.value = "";
                  }}
                />
                <div className="mt-2 text-xs leading-relaxed text-muted">
                  支持 PNG / JPEG / WebP，单张不超过 25 MB；还可再添加{" "}
                  {Math.max(0, maxRefs - selected.length)} 张（共 {selected.length}/{maxRefs} 张）。上传后自动加入下方已选区。
                </div>
              </div>
            )}
            {activeTab === "paste" && (
              <div
                ref={pasteZoneRef}
                tabIndex={0}
                className={
                  "cursor-pointer rounded-xl border-2 border-dashed px-4 py-8 text-center text-[13px] leading-relaxed outline-none " +
                  (dragOver ? "border-accent text-text" : "border-border text-muted")
                }
                onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.multiple = true;
                  input.accept = "image/png,image/jpeg,image/webp";
                  input.onchange = () => {
                    if (input.files?.length) uploadFiles(Array.from(input.files));
                  };
                  input.click();
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  if (e.dataTransfer.files?.length) uploadFiles(Array.from(e.dataTransfer.files));
                }}
              >
                点击选择文件，或将图片拖拽到此处；也可以直接在页面内按 Ctrl+V 粘贴剪贴板图片
              </div>
            )}
            {activeTab === "history" && (
              <RefPickerGrid
                items={historyImages.map((img) => ({
                  id: img.id,
                  url: imageThumbUrl(img),
                  name: img.id.slice(0, 8),
                  source: "img" as const,
                  fileMissing: img.fileMissing,
                }))}
                emptyText="该项目还没有历史图片"
                selected={selected}
                maxRefs={maxRefs}
                onToggle={(item) => toggleSelected(item, setSelected, maxRefs)}
                onInsertName={insertAtCursor}
                onRename={null}
                onClose={() => setPopupOpen(false)}
              />
            )}
            {activeTab === "library" && (
              <RefPickerGrid
                items={libRefs.map((r) => ({
                  id: r.id,
                  url: referenceFileUrl(r.id),
                  name: r.name || "参考图",
                  source: "ref" as const,
                  fileMissing: r.fileMissing,
                }))}
                emptyText="参考图库为空，可通过「本地上传」或「粘贴/拖拽」添加"
                selected={selected}
                maxRefs={maxRefs}
                onToggle={(item) => toggleSelected(item, setSelected, maxRefs)}
                onInsertName={insertAtCursor}
                onRename={renameReference}
                onClose={() => setPopupOpen(false)}
              />
            )}
          </div>
        </div>
      )}

      {/* Prompt */}
      <textarea
        ref={promptRef}
        className="input-text min-h-[74px]"
        placeholder="例如：一只橘猫坐在窗边晒太阳，写实风格（Ctrl+Enter 提交）"
        aria-label="提示词"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={onPromptKeyDown}
      />
      {caps.supports_negative_prompt && (
        <textarea
          className="input-text mt-2.5 min-h-[40px]"
          placeholder="负面提示词（可选）：不希望画面中出现的元素"
          aria-label="负面提示词"
          value={negative}
          onChange={(e) => setNegative(e.target.value)}
        />
      )}

      {/* 控件行 */}
      <div className="mt-2.5 flex flex-wrap items-end gap-2.5 max-[560px]:flex-col max-[560px]:items-stretch">
        <div className="flex min-w-0 flex-col gap-1">
          <label className="text-[11px] text-muted">比例</label>
          <select
            className="input-select max-w-[160px]"
            aria-label="比例"
            value={ratio ?? ""}
            onChange={(e) => setRatio(e.target.value)}
          >
            {ratios.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <label className="text-[11px] text-muted">分辨率</label>
          <select
            className="input-select max-w-[160px]"
            aria-label="分辨率"
            value={size ?? ""}
            onChange={(e) => setSize(e.target.value)}
          >
            {sizesOfRatio(ratio ?? "").map((s) => (
              <option key={s.size} value={s.size}>
                {s.size}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted">数量</label>
          <div className="inline-flex gap-0.5 rounded-lg border border-border bg-panel2 p-[3px]" role="group" aria-label="数量">
            {[1, 2, 4].map((v) => (
              <button
                key={v}
                type="button"
                className={
                  "cursor-pointer rounded-md border-none px-3.5 py-1.5 text-[13px] " +
                  (n === v ? "bg-accent text-white" : "bg-transparent text-muted")
                }
                onClick={() => setN(v)}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
        {caps.supports_quality && caps.quality_options?.length > 0 && (
          <div className="flex min-w-0 flex-col gap-1">
            <label className="text-[11px] text-muted">质量</label>
            <select
              className="input-select max-w-[160px]"
              aria-label="质量"
              value={quality ?? ""}
              onChange={(e) => setQuality(e.target.value || null)}
            >
              {caps.quality_options.map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <label className="text-[11px] text-muted">分类</label>
          <select
            className="input-select max-w-[160px]"
            aria-label="分类"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">未分类</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 已选参考条 */}
      <div className="mt-2.5 flex items-center gap-2.5">
        <button
          type="button"
          className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-border bg-transparent px-3 py-2 text-[13px] text-text transition-colors hover:border-accent hover:text-accent"
          onClick={() => setPopupOpen((v) => !v)}
        >
          ＋ 参考图 <span className="text-xs text-muted">{selected.length}/{maxRefs}</span>
        </button>
        {selected.length > 0 && (
          <div className="flex flex-1 gap-2 overflow-x-auto p-0.5">
            {selected.map((item) => (
              <div key={item.id} className="flex w-16 shrink-0 flex-col gap-1">
                <div className="relative size-16">
                  <img
                    src={item.url}
                    alt={item.name}
                    title={item.name}
                    className="size-full rounded-lg border border-border bg-black object-cover"
                  />
                  {item.source === "ref" && (
                    <button
                      type="button"
                      title="重命名参考图"
                      aria-label={"重命名参考图 " + item.name}
                      className="absolute -top-1.5 -left-1.5 flex size-[18px] cursor-pointer items-center justify-center rounded-full border border-border bg-panel2 text-[11px] text-text hover:border-accent hover:text-accent"
                      onClick={() => renameReference(item)}
                    >
                      ✎
                    </button>
                  )}
                  <button
                    type="button"
                    title="移除"
                    aria-label={"移除参考图 " + item.name}
                    className="absolute -top-1.5 -right-1.5 flex size-[18px] cursor-pointer items-center justify-center rounded-full border border-border bg-panel2 text-xs text-text hover:border-err hover:text-err"
                    onClick={() => setSelected((prev) => prev.filter((s) => s.id !== item.id))}
                  >
                    ×
                  </button>
                </div>
                <button
                  type="button"
                  title="点击插入名称到 Prompt"
                  className="cursor-pointer truncate border-none bg-transparent px-0 text-center text-[11px] leading-tight text-muted hover:text-accent"
                  onClick={() => insertAtCursor(item.name)}
                >
                  {item.name}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 操作行 */}
      <div className="mt-2.5 flex items-center justify-end gap-2.5">
        <button
          type="button"
          className="btn-ghost mr-auto"
          title="清空输入内容（保留分类）"
          onClick={clearInput}
        >
          清空
        </button>
        <button type="button" className="btn-ghost" onClick={saveAsTemplate}>
          存为模板
        </button>
        <button type="button" className="btn-primary px-7 py-2.5 text-[15px]" disabled={isBusy} onClick={submit}>
          {isBusy && <span className="size-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
          {isBusy ? (busy && !submitting ? "生成中…" : "提交中…") : "生成"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 参考图选择网格（历史图片 / 参考图库 tab 共用）
// ---------------------------------------------------------------------------

interface PickerItem {
  id: string;
  url: string;
  name: string;
  source: "ref" | "img";
  fileMissing?: boolean;
}

function toggleSelected(
  item: PickerItem,
  setSelected: React.Dispatch<React.SetStateAction<SelectedRef[]>>,
  maxRefs: number
) {
  setSelected((prev) => {
    const idx = prev.findIndex((s) => s.id === item.id);
    if (idx >= 0) {
      const next = [...prev];
      next.splice(idx, 1);
      return next;
    }
    if (prev.length >= maxRefs) {
      toast.error(`参考图最多 ${maxRefs} 张，请先移除部分参考图`);
      return prev;
    }
    return [...prev, { id: item.id, url: item.url, name: item.name, source: item.source }];
  });
}

function RefPickerGrid({
  items,
  emptyText,
  selected,
  maxRefs,
  onToggle,
  onInsertName,
  onRename,
  onClose,
}: {
  items: PickerItem[];
  emptyText: string;
  selected: SelectedRef[];
  maxRefs: number;
  onToggle: (item: PickerItem) => void;
  onInsertName: (name: string) => void;
  onRename: ((item: SelectedRef) => Promise<void>) | null;
  onClose: () => void;
}) {
  if (!items.length) {
    return <div className="px-2 py-4 text-center text-xs text-muted">{emptyText}</div>;
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(86px,1fr))] gap-2.5">
      {items.map((item) => {
        const isSelected = selected.some((s) => s.id === item.id);
        return (
          <button
            key={item.id}
            type="button"
            className={
              "relative aspect-square cursor-pointer overflow-hidden rounded-lg border bg-panel2 " +
              (item.fileMissing
                ? "cursor-not-allowed border-border opacity-45"
                : isSelected
                  ? "border-accent shadow-[0_0_0_2px_rgba(0,158,250,0.35)]"
                  : "border-border hover:border-accent")
            }
            onClick={() => {
              if (item.fileMissing) {
                toast.error("该图片文件缺失，不能作为参考图");
                return;
              }
              onToggle(item);
              // 选择后自动收起弹层
              setTimeout(onClose, 300);
            }}
          >
            {!item.fileMissing ? (
              <img src={item.url} alt={item.name} loading="lazy" className="size-full object-cover" />
            ) : (
              <span className="absolute top-1 left-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] text-warn">
                文件缺失
              </span>
            )}
            <span className="absolute bottom-0 left-0 right-0 flex items-center gap-1 bg-[linear-gradient(transparent,rgba(0,0,0,0.75))] px-1.5 py-0.5 text-left text-[10px] text-[#dfe3ec]">
              <span
                className="min-w-0 flex-1 truncate"
                title="点击插入名称到 Prompt"
                onClick={(e) => {
                  e.stopPropagation();
                  onInsertName(item.name);
                  onClose();
                }}
              >
                {item.name}
              </span>
              {onRename && !item.fileMissing && item.source === "ref" && (
                <span
                  title="重命名参考图"
                  className="shrink-0 cursor-pointer text-[11px] text-warn hover:text-white"
                  onClick={(e) => {
                    e.stopPropagation();
                    const target = selected.find((s) => s.id === item.id) ?? {
                      id: item.id,
                      url: item.url,
                      name: item.name,
                      source: item.source,
                    };
                    onRename(target);
                  }}
                >
                  ✎
                </span>
              )}
            </span>
            {isSelected && (
              <span className="absolute top-1 right-1 flex size-[18px] items-center justify-center rounded-full bg-accent text-xs text-white">
                ✓
              </span>
            )}
          </button>
        );
      })}
      <span className="hidden">{maxRefs}</span>
    </div>
  );
}

export default InputArea;
