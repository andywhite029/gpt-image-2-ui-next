"use client";

// 全屏图片查看器：左大图（左右箭头切换）+ 右侧 420px 详情面板

import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { endpoints, imageUrl, errorText, copyText, referenceFileUrl } from "@/lib/api-client";
import { fmtFullTime, formatBytes } from "@/lib/format";
import { useImageDetail, useCategoriesForImage, usePatchImage, useDeleteImage, useAddToReferenceLibrary } from "@/hooks/use-images";
import { useModal } from "@/components/ui/modal";
import { Tag } from "@/components/ui/badge";
import { Loading } from "@/components/ui/empty";
import { toast } from "sonner";
import type { ImageSummary, ReferenceSummary } from "@/types/entities";

export interface LightboxProps {
  /** 当前图片 id */
  imageId: string;
  /** 可切换的图片 id 列表（左右箭头导航） */
  siblingIds?: string[];
  onClose: () => void;
  /** 打开另一张图片（同 lightbox 内切换） */
  onOpenImage?: (id: string) => void;
  /** 跳转到对话（继续修改等） */
  onGoConversation?: (pid: string, cid: string) => void;
}

export function Lightbox({
  imageId,
  siblingIds = [],
  onClose,
  onOpenImage,
  onGoConversation,
}: LightboxProps) {
  const qc = useQueryClient();
  const modal = useModal();
  const { data: detail, isLoading, error } = useImageDetail(imageId);
  const image = detail?.image ?? null;
  const [noteDraft, setNoteDraft] = useState<string | null>(null);

  const patchImage = usePatchImage();
  const deleteImage = useDeleteImage();
  const addToRef = useAddToReferenceLibrary();

  // 左右切换（siblingIds 内导航）
  const idx = siblingIds.indexOf(imageId);
  const goPrev = useCallback(() => {
    if (idx > 0) onOpenImage?.(siblingIds[idx - 1]!);
  }, [idx, siblingIds, onOpenImage]);
  const goNext = useCallback(() => {
    if (idx >= 0 && idx < siblingIds.length - 1) onOpenImage?.(siblingIds[idx + 1]!);
  }, [idx, siblingIds, onOpenImage]);

  // 键盘：Esc 关闭 / 左右箭头切换
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, goPrev, goNext]);

  // 锁定 body 滚动
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (isLoading) {
    return (
      <LightboxBackdrop onClose={onClose}>
        <div className="flex flex-1 items-center justify-center gap-2.5 text-[13px] text-white">
          <span className="spinner" />
          <span>加载图片…</span>
        </div>
      </LightboxBackdrop>
    );
  }

  if (error || !image) {
    return (
      <LightboxBackdrop onClose={onClose}>
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="rounded-xl bg-panel px-8 py-6 text-[13px] text-muted">
            图片详情加载失败：{error ? errorText(error) : "未找到"}
          </div>
        </div>
      </LightboxBackdrop>
    );
  }

  const request = detail?.request ?? null;
  const params = (request?.parameters ?? {}) as Record<string, unknown>;
  const previewSrc = image.previewUrl ?? image.url ?? imageUrl.preview(image.id);
  const noteValue = noteDraft ?? image.userNote ?? "";

  const doPatch = async (d: Parameters<typeof patchImage.mutateAsync>[0]) => {
    try {
      await patchImage.mutateAsync(d);
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const onContinue = async () => {
    if (!request) {
      toast.error("缺少生成请求信息，无法填回");
      return;
    }
    try {
      const payload = await endpoints.editRetry(request.id);
      // 通过 sessionStorage 暂存预填参数，进入对话页时消费
      sessionStorage.setItem(
        "gpt_image2_prefill",
        JSON.stringify({ ...payload, extra_image_id: image.id })
      );
      toast.success("已填回输入区（进入对应对话后生效）");
      onClose();
      if (onGoConversation) onGoConversation(image.projectId, image.conversationId);
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const onFav = async () => {
    await doPatch({ iid: image.id, is_favorited: !image.isFavorited });
    toast.success(image.isFavorited ? "已取消收藏" : "已收藏");
  };

  const onDelete = async () => {
    const ok = await modal.confirmModal({
      title: "删除图片",
      message: "图片将移入回收站，可在回收站中恢复或彻底删除。确定删除吗？",
      danger: true,
      confirmText: "移入回收站",
    });
    if (!ok) return;
    try {
      await deleteImage.mutateAsync(image.id);
      toast.success("已移入回收站");
      onClose();
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const onAddRef = async () => {
    try {
      await addToRef.mutateAsync(image.id);
      toast.success("已加入参考图库");
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const onCopyPrompt = async () => {
    const text = request?.promptOriginal ?? request?.promptEffective ?? "";
    if (!text) {
      toast.error("该图没有可复制的 Prompt");
      return;
    }
    const ok = await copyText(text);
    if (ok) toast.success("Prompt 已复制");
    else toast.error("复制失败");
  };

  return (
    <LightboxBackdrop onClose={onClose}>
      {/* 左右切换箭头 */}
      {idx > 0 && (
        <button
          type="button"
          aria-label="上一张"
          className="absolute top-1/2 left-4 z-10 flex size-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-[rgba(255,255,255,0.28)] bg-[rgba(0,0,0,0.45)] text-xl text-white transition-colors hover:border-white hover:bg-[rgba(0,0,0,0.65)]"
          onClick={goPrev}
        >
          ‹
        </button>
      )}
      {idx >= 0 && idx < siblingIds.length - 1 && (
        <button
          type="button"
          aria-label="下一张"
          className="absolute top-1/2 right-4 z-10 flex size-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-[rgba(255,255,255,0.28)] bg-[rgba(0,0,0,0.45)] text-xl text-white transition-colors hover:border-white hover:bg-[rgba(0,0,0,0.65)]"
          onClick={goNext}
        >
          ›
        </button>
      )}

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* 左侧大图 */}
        <div
          className="flex min-w-0 flex-1 items-center justify-center p-5 md:pl-7"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          {image.fileMissing ? (
            <div className="rounded-xl bg-panel px-8 py-6 text-[13px] text-muted">
              文件缺失，仅保留元数据
            </div>
          ) : (
            <img
              src={previewSrc}
              alt={image.id}
              title="点击查看原图"
              className="max-h-full max-w-full cursor-zoom-in rounded-xl bg-black object-contain shadow-2xl max-md:flex-[0_0_46vh]"
              onClick={(e) => {
                e.stopPropagation();
                window.open(imageUrl.file(image.id), "_blank", "noopener");
              }}
            />
          )}
        </div>

        {/* 右侧详情面板 */}
        <div className="max-md:flex-1 w-full shrink-0 overflow-y-auto border-t border-border bg-panel p-4 md:w-[420px] md:border-t-0 md:border-l">
          {/* 操作按钮 */}
          <div className="flex flex-wrap gap-2">
            {!image.fileMissing && (
              <a
                className="btn-ghost btn-ghost-sm"
                href={imageUrl.file(image.id)}
                download={(image.id || "image") + ".png"}
                onClick={(e) => e.stopPropagation()}
              >
                ⬇ 下载
              </a>
            )}
            <button type="button" className="btn-ghost btn-ghost-sm" onClick={onContinue}>
              ✏ 继续修改
            </button>
            <button type="button" className="btn-ghost btn-ghost-sm" onClick={onAddRef}>
              🧩 加参考库
            </button>
            <button type="button" className="btn-ghost btn-ghost-sm" onClick={onCopyPrompt}>
              📋 复制 Prompt
            </button>
            <button type="button" className="btn-ghost btn-ghost-sm" onClick={onFav}>
              {image.isFavorited ? "★ 已收藏" : "☆ 收藏"}
            </button>
          </div>

          {/* 元数据表 */}
          <table className="meta-table">
            <tbody>
              <tr>
                <th>Prompt</th>
                <td className="whitespace-pre-wrap break-words">
                  {request?.promptOriginal ?? request?.promptEffective ?? "—"}
                </td>
              </tr>
              {request?.promptEffective &&
                request.promptEffective !== request.promptOriginal && (
                  <tr>
                    <th>实际发送</th>
                    <td className="break-words">
                      {request.promptEffective}{" "}
                      <button
                        type="button"
                        className="btn-mini ml-1"
                        onClick={async () => {
                          const ok = await copyText(request.promptEffective ?? "");
                          ok ? toast.success("已复制") : toast.error("复制失败");
                        }}
                      >
                        复制
                      </button>
                    </td>
                  </tr>
                )}
              {request?.negativePromptOriginal && (
                <tr>
                  <th>负面 Prompt</th>
                  <td className="whitespace-pre-wrap break-words">
                    {request.negativePromptOriginal}
                  </td>
                </tr>
              )}
              <tr>
                <th>参数</th>
                <td>
                  {[
                    params.model ? `模型 ${String(params.model)}` : null,
                    params.size ? `尺寸 ${String(params.size)}` : null,
                    params.n ? `数量 ${String(params.n)}` : null,
                    params.quality_effective
                      ? `质量 ${String(params.quality_effective)}`
                      : params.quality_user_choice
                        ? `质量 ${String(params.quality_user_choice)}（未发送）`
                        : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </td>
              </tr>
              <tr>
                <th>时间</th>
                <td>{fmtFullTime(image.createdAt)}</td>
              </tr>
              <tr>
                <th>文件</th>
                <td>
                  {image.fileMissing
                    ? "文件缺失"
                    : `${formatBytes(image.fileSize)} · ${image.mimetype}`}
                </td>
              </tr>
              {detail?.conversation_title && (
                <tr>
                  <th>对话</th>
                  <td>
                    <button
                      type="button"
                      className="cursor-pointer text-accent hover:underline"
                      onClick={() => {
                        onClose();
                        onGoConversation?.(image.projectId, image.conversationId);
                      }}
                    >
                      {detail.conversation_title}
                    </button>
                  </td>
                </tr>
              )}
              <tr>
                <th>批次</th>
                <td>{image.batchId || "—"}</td>
              </tr>
            </tbody>
          </table>

          {/* 标签 + 备注 */}
          <DetailEditableSection image={image} onPatch={doPatch} noteValue={noteValue} setNoteDraft={setNoteDraft} modal={modal} />

          {/* 参考图 / 来源图 / 同批图 */}
          {detail?.reference_assets && detail.reference_assets.length > 0 && (
            <ReferenceStrip refs={detail.reference_assets} onOpen={onOpenImage} />
          )}
          {detail?.source_images && detail.source_images.length > 0 && (
            <ThumbSection
              title="来源图"
              images={detail.source_images}
              onOpen={(id) => onOpenImage?.(id)}
            />
          )}
          {detail?.batch_siblings && detail.batch_siblings.length > 0 && (
            <ThumbSection
              title="同批次图片"
              images={detail.batch_siblings}
              onOpen={(id) => onOpenImage?.(id)}
            />
          )}

          {/* 移动分类 */}
          <MoveCategorySection image={image} />

          {/* 删除 */}
          <div className="mt-4">
            <button type="button" className="btn-danger px-3 py-1.5 text-xs" onClick={onDelete}>
              🗑 删除图片
            </button>
          </div>
        </div>
      </div>
    </LightboxBackdrop>
  );
}

// ---------------------------------------------------------------------------
// 子组件
// ---------------------------------------------------------------------------

function LightboxBackdrop({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-[rgba(5,7,10,0.88)] backdrop-blur-md"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <button
        type="button"
        aria-label="关闭"
        className="absolute top-4 right-5 z-10 flex size-[38px] cursor-pointer items-center justify-center rounded-full border border-[rgba(255,255,255,0.28)] bg-[rgba(0,0,0,0.45)] text-xl text-white transition-colors hover:border-white hover:bg-[rgba(0,0,0,0.65)]"
        onClick={onClose}
      >
        ×
      </button>
      {children}
    </div>
  );
}

function DetailEditableSection({
  image,
  onPatch,
  noteValue,
  setNoteDraft,
  modal,
}: {
  image: ImageSummary;
  onPatch: (d: { iid: string; user_note?: string; tags?: string[] }) => Promise<void>;
  noteValue: string;
  setNoteDraft: (v: string | null) => void;
  modal: ReturnType<typeof useModal>;
}) {
  return (
    <>
      <table className="meta-table">
        <tbody>
          <tr>
            <th>标签</th>
            <td>
              {image.tags?.length ? (
                <span className="flex flex-wrap gap-1">
                  {image.tags.map((t) => (
                    <Tag key={t}>{t}</Tag>
                  ))}
                </span>
              ) : (
                "—"
              )}{" "}
              <button
                type="button"
                className="btn-mini ml-1"
                onClick={async () => {
                  const val = await modal.promptModal({
                    title: "编辑标签",
                    label: "多个标签用逗号分隔",
                    value: (image.tags ?? []).join(", "),
                  });
                  if (val === null) return;
                  const tags = val.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
                  await onPatch({ iid: image.id, tags });
                  toast.success("标签已更新");
                }}
              >
                编辑
              </button>
            </td>
          </tr>
          <tr>
            <th>备注</th>
            <td>
              <div className="flex items-start gap-1">
                <span className="min-w-0 flex-1 break-words">{noteValue || "—"}</span>
                <button
                  type="button"
                  className="btn-mini shrink-0"
                  onClick={async () => {
                    const val = await modal.promptModal({
                      title: "编辑备注",
                      label: "备注内容",
                      value: image.userNote ?? "",
                      textarea: true,
                    });
                    if (val === null) return;
                    setNoteDraft(val.trim());
                    await onPatch({ iid: image.id, user_note: val.trim() });
                    toast.success("备注已更新");
                  }}
                >
                  编辑
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

function ReferenceStrip({
  refs,
  onOpen,
}: {
  refs: ReferenceSummary[];
  onOpen?: (id: string) => void;
}) {
  return (
    <div className="mt-4">
      <div className="section-title mb-2 mt-0">使用过的参考图（{refs.length}）</div>
      <div className="thumb-strip">
        {refs.map((ref) =>
          !ref.fileMissing ? (
            <img
              key={ref.id}
              src={referenceFileUrl(ref.id)}
              alt={ref.name}
              title={ref.name}
              loading="lazy"
              className="size-[52px] shrink-0 cursor-pointer rounded-md border border-border bg-black object-cover"
              onClick={() => onOpen?.(ref.id)}
            />
          ) : (
            <span
              key={ref.id}
              title={(ref.name || ref.id) + " 不可用"}
              className="flex size-[52px] shrink-0 items-center justify-center rounded-md border border-border bg-panel2 p-1 text-center text-[10px] break-all text-muted"
            >
              已删除/缺失
            </span>
          )
        )}
      </div>
    </div>
  );
}

function ThumbSection({
  title,
  images,
  onOpen,
}: {
  title: string;
  images: ImageSummary[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="mt-4">
      <div className="section-title mb-2 mt-0">
        {title}（{images.length}）
      </div>
      <div className="thumb-strip">
        {images.map((img) => (
          <img
            key={img.id}
            src={img.thumbnailUrl ?? imageUrl.thumbnail(img.id)}
            alt={img.id}
            title="查看详情"
            loading="lazy"
            className="size-[52px] shrink-0 cursor-pointer rounded-md border border-border bg-black object-cover"
            onClick={() => onOpen(img.id)}
          />
        ))}
      </div>
    </div>
  );
}

function MoveCategorySection({ image }: { image: ImageSummary }) {
  const { data: categories } = useCategoriesForImage(image.projectId);
  const patchImage = usePatchImage();
  const [target, setTarget] = useState(image.categoryId ?? "");

  return (
    <div className="mt-4">
      <div className="section-title mb-2 mt-0">移动分类</div>
      <div className="flex gap-2">
        <select
          className="input-select flex-1"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        >
          <option value="">未分类</option>
          {(categories ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn-ghost btn-ghost-sm"
          disabled={patchImage.isPending}
          onClick={async () => {
            try {
              await patchImage.mutateAsync({ iid: image.id, category_id: target || null });
              toast.success("已移动分类");
            } catch (e) {
              toast.error(errorText(e));
            }
          }}
        >
          移动
        </button>
      </div>
    </div>
  );
}
