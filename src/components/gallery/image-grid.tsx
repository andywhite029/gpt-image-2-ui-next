"use client";

// 图片网格：auto-fill minmax(160px,1fr)，横图跨 3 列、竖图跨 2 列

import { useState } from "react";
import { Star } from "lucide-react";
import { imageThumbUrl } from "@/lib/api-client";
import type { ImageSummary } from "@/types/entities";

export interface ImageGridProps {
  images: ImageSummary[];
  onImageClick?: (image: ImageSummary) => void;
  /** 空状态文案 */
  emptyText?: string;
  className?: string;
}

/** 单个图片 cell：加载后按宽高比加 wide/tall class */
function GridItem({
  image,
  onClick,
}: {
  image: ImageSummary;
  onClick?: () => void;
}) {
  const [span, setSpan] = useState<"" | "wide" | "tall">("");

  const showImage = !image.fileMissing;

  return (
    <button
      type="button"
      title={image.userNote || image.id}
      onClick={onClick}
      className={
        "group relative cursor-pointer overflow-hidden rounded-lg border border-border bg-panel2 text-left transition-colors hover:border-accent " +
        (span === "wide"
          ? "col-span-3"
          : span === "tall"
            ? "col-span-2"
            : "col-span-1")
      }
    >
      {showImage ? (
        <img
          src={imageThumbUrl(image)}
          alt={image.id}
          loading="lazy"
          className="block h-auto w-full"
          onLoad={(e) => {
            const img = e.currentTarget;
            if (!img.naturalWidth || !img.naturalHeight) return;
            const ratio = img.naturalWidth / img.naturalHeight;
            if (ratio >= 1.2) setSpan("wide");
            else if (ratio < 0.8) setSpan("tall");
          }}
          onError={(e) => {
            e.currentTarget.replaceWith(
              Object.assign(document.createElement("div"), {
                className: "flex min-h-[120px] w-full items-center justify-center bg-panel2 p-2 text-center text-xs text-faint",
                textContent: image.fileMissing ? "文件缺失" : "加载失败",
              })
            );
          }}
        />
      ) : (
        <div className="flex min-h-[120px] w-full items-center justify-center bg-panel2 p-2 text-center text-xs text-faint">
          文件缺失
        </div>
      )}

      {/* 收藏星（已收藏常驻 + 弹出动效；未收藏 hover 淡入） */}
      <span
        className={
          "pointer-events-none absolute top-1.5 right-1.5 leading-none opacity-0 transition-opacity group-hover:opacity-100 " +
          (image.isFavorited ? "text-warn opacity-100 anim-pop" : "text-white/90 [text-shadow:0_0_3px_rgba(0,0,0,0.9)]")
        }
      >
        <Star size={15} strokeWidth={1.8} fill={image.isFavorited ? "currentColor" : "none"} />
      </span>

      {/* partial badge（来源批次失败） */}
      {image.isFromFailedBatch && (
        <span className="absolute bottom-0 left-0 right-0 bg-[rgba(255,146,46,0.85)] px-2 py-0.5 text-center text-[10px] text-white">
          来源批次失败
        </span>
      )}

      {/* hover 名称 */}
      <span className="absolute bottom-0 left-0 right-0 hidden truncate bg-[linear-gradient(transparent,rgba(0,0,0,0.75))] px-2 py-1 text-[11px] text-muted group-hover:block">
        {image.userNote || image.tags?.join(" ") || image.id}
      </span>
    </button>
  );
}

export function ImageGrid({
  images,
  onImageClick,
  emptyText = "暂无图片",
  className = "",
}: ImageGridProps) {
  if (!images.length) {
    return <div className="empty">{emptyText}</div>;
  }
  return (
    <div
      className={
        "grid auto-rows-auto auto-flow-dense grid-cols-[repeat(auto-fill,minmax(160px,1fr))] items-start gap-2.5 " +
        className
      }
    >
      {images.map((image) => (
        <GridItem
          key={image.id}
          image={image}
          onClick={onImageClick ? () => onImageClick(image) : undefined}
        />
      ))}
    </div>
  );
}
