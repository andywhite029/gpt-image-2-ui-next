"use client";

// 回收站：缩略图预览 + 搜索过滤 + 恢复 / 彻底删除 / 清空
// 被引用（无法彻底删除）的条目直接标出，不用点删除吃 409 才知道

import { useState } from "react";
import { toast } from "sonner";
import { useTrash, useRestoreTrash, usePurgeTrash, useEmptyTrash } from "@/hooks/use-library";
import { useModal } from "@/components/ui/modal";
import { ViewHeader, Loading, ErrorBox, Empty } from "@/components/ui/empty";
import { errorText } from "@/lib/api-client";
import { fmtFullTime } from "@/lib/format";
import type { TrashItem } from "@/types/entities";

const TRASH_TYPE_LABEL: Record<string, string> = {
  conversation: "对话",
  image: "图片",
  reference: "参考图",
};

export default function TrashPage() {
  const modal = useModal();
  const { data: items = [], isLoading, error } = useTrash();
  const restore = useRestoreTrash();
  const purge = usePurgeTrash();
  const emptyTrash = useEmptyTrash();
  const [filter, setFilter] = useState("");

  if (isLoading) return <Loading text="加载回收站…" />;
  if (error) return <ErrorBox message={"加载失败：" + errorText(error)} />;

  const q = filter.trim().toLowerCase();
  const filtered = q
    ? items.filter((item) =>
        [item.entityTitle, TRASH_TYPE_LABEL[item.entityType], item.projectName]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q)
      )
    : items;

  const onEmpty = async () => {
    if (!items.length) {
      toast.info("回收站是空的");
      return;
    }
    const ok = await modal.confirmModal({
      title: "清空回收站",
      message: `将彻底删除全部 ${items.length} 条记录（不可恢复）。被引用的内容会强制删除：其「生成来源」参考图一并删除，历史生成请求中的参考图将显示为「已删除」。确定清空吗？`,
      danger: true,
      confirmText: "清空回收站",
    });
    if (!ok) return;
    try {
      const res = await emptyTrash.mutateAsync();
      toast.success(
        `已彻底删除 ${res.purged ?? items.length} 条${
          res.failed?.length ? `，${res.failed.length} 条删除失败` : ""
        }`
      );
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const onRestore = async (item: TrashItem) => {
    try {
      await restore.mutateAsync({ type: item.entityType, eid: item.entityId });
      toast.success("已恢复");
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const onPurge = async (item: TrashItem) => {
    if (item.blocked) {
      // 被引用：强删，二次确认说明级联后果
      const ok = await modal.confirmModal({
        title: "强制彻底删除（该内容正被引用）",
        message:
          "该内容仍被其他图片、参考图或生成记录引用。强制删除后：引用它的「生成来源」参考图将一并删除；引用它的历史生成请求会保留，但其中的参考图会显示为「已删除」。删除后不可恢复，确定继续吗？",
        danger: true,
        confirmText: "强制删除",
      });
      if (!ok) return;
      try {
        await purge.mutateAsync({ type: item.entityType, eid: item.entityId, force: true });
        toast.success("已强制彻底删除");
      } catch (e) {
        toast.error(errorText(e));
      }
      return;
    }
    const ok = await modal.confirmModal({
      title: "彻底删除",
      message: "彻底删除后不可恢复，确定继续吗？",
      danger: true,
      confirmText: "彻底删除",
    });
    if (!ok) return;
    try {
      await purge.mutateAsync({ type: item.entityType, eid: item.entityId });
      toast.success("已彻底删除");
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  /** 点击缩略图放大预览（1280px preview） */
  const onPreview = (url: string, title: string) => {
    modal.openModal({
      title: title,
      wide: true,
      body: (
        <img
          src={url}
          alt={title}
          className="mx-auto max-h-[70vh] w-auto max-w-full rounded-lg bg-black object-contain"
        />
      ),
      actions: [{ label: "关闭", kind: "ghost" }],
    });
  };

  return (
    <div>
      <ViewHeader
        title="🗑 回收站"
        desc="删除的内容先进入回收站；被引用的内容可强制删除（级联清理引用方）。"
        actions={
          <button
            type="button"
            className="btn-ghost btn-ghost-sm"
            disabled={emptyTrash.isPending || !items.length}
            onClick={onEmpty}
          >
            🧹 清空回收站
          </button>
        }
      />

      {!items.length ? (
        <Empty text="回收站是空的" />
      ) : (
        <>
          <div className="filter-bar">
            <input
              type="search"
              className="input-text w-auto min-w-[200px]"
              placeholder="按标题/类型过滤"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          {!filtered.length ? (
            <Empty text="没有匹配的回收站记录" />
          ) : (
            <div className="row-list">
              {filtered.map((item) => (
                <TrashRow
                  key={item.entityType + item.entityId}
                  item={item}
                  restorePending={restore.isPending}
                  purgePending={purge.isPending}
                  onRestore={onRestore}
                  onPurge={onPurge}
                  onPreview={onPreview}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TrashRow({
  item,
  restorePending,
  purgePending,
  onRestore,
  onPurge,
  onPreview,
}: {
  item: TrashItem;
  restorePending: boolean;
  purgePending: boolean;
  onRestore: (item: TrashItem) => void;
  onPurge: (item: TrashItem) => void;
  onPreview: (url: string, title: string) => void;
}) {
  const casc = item.cascadeIds;
  const cascText =
    item.entityType === "conversation" ? ` · 级联 ${casc?.images?.length || 0} 张图片` : "";
  const loc = item.originalLocation?.category_name
    ? ` · 原分类：${item.originalLocation.category_name}`
    : "";
  const previews = item.previews ?? [];
  const blocked = !!item.blocked;

  return (
    <div className="row-item">
      {/* 缩略图条（无图时显示占位） */}
      {previews.length ? (
        <div
          className="flex shrink-0 items-center gap-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          {previews.map((p) => (
            <img
              key={p.url}
              src={p.url}
              alt={p.title}
              loading="lazy"
              title="点击放大"
              className="size-[52px] shrink-0 cursor-pointer rounded-md border border-border bg-black object-cover transition-all duration-[var(--dur-fast)] hover:border-accent"
              onClick={() => onPreview(p.fullUrl, item.entityTitle || p.title)}
              onError={(e) => (e.currentTarget as HTMLImageElement).remove()}
            />
          ))}
        </div>
      ) : (
        <div className="flex size-[52px] shrink-0 items-center justify-center rounded-md border border-border bg-panel2 text-[10px] text-faint">
          无图
        </div>
      )}
      <div className="ri-main">
        <div className="ri-title">
          <span className="tag">{TRASH_TYPE_LABEL[item.entityType] || item.entityType}</span>{" "}
          {item.entityTitle || item.entityId}
          {blocked && (
            <span
              className="tag ml-1 border-[rgba(255,146,46,0.45)] text-warn"
              title="仍被其他图片、参考图或生成记录引用；删除时需强制删除"
            >
              ⚠ 被引用
            </span>
          )}
        </div>
        <div className="ri-sub">
          {item.projectName || item.projectId}
          {loc}
          {cascText} · 删除于 {fmtFullTime(item.deletedAt)}
          {blocked && " · 强删将级联清理引用"}
        </div>
      </div>
      <div className="ri-side">
        <button
          type="button"
          className="btn-ghost btn-ghost-sm"
          disabled={restorePending}
          onClick={() => onRestore(item)}
        >
          恢复
        </button>
        <button
          type="button"
          className="btn-danger px-3 py-1.5 text-xs"
          disabled={purgePending}
          title={blocked ? "仍被引用，将强制删除并级联清理引用方" : undefined}
          onClick={() => onPurge(item)}
        >
          {blocked ? "强制删除" : "彻底删除"}
        </button>
      </div>
    </div>
  );
}
