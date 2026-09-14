"use client";

// 回收站：列表 + 搜索过滤 + 恢复 / 彻底删除 / 清空

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
      message: `将彻底删除全部 ${items.length} 条记录（不可恢复）。每项删除前都会做引用检查，被引用的项目会保留。确定清空吗？`,
      danger: true,
      confirmText: "清空回收站",
    });
    if (!ok) return;
    try {
      const res = await emptyTrash.mutateAsync();
      toast.success(
        `已彻底删除 ${res.purged ?? items.length} 条${
          res.failed?.length ? `，${res.failed.length} 条因被引用而保留` : ""
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
    const ok = await modal.confirmModal({
      title: "彻底删除",
      message: "彻底删除前会检查该内容是否仍被其他图片或生成记录引用；被引用时将无法删除。删除后不可恢复，确定继续吗？",
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

  return (
    <div>
      <ViewHeader
        title="🗑 回收站"
        desc="删除的内容先进入回收站；彻底删除前会做引用检查。"
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
              {filtered.map((item) => {
                const casc = item.cascadeIds;
                const cascText =
                  item.entityType === "conversation" ? ` · 级联 ${casc?.images?.length || 0} 张图片` : "";
                const loc = item.originalLocation?.category_name
                  ? ` · 原分类：${item.originalLocation.category_name}`
                  : "";
                return (
                  <div key={item.entityType + item.entityId} className="row-item">
                    <div className="ri-main">
                      <div className="ri-title">
                        <span className="tag">{TRASH_TYPE_LABEL[item.entityType] || item.entityType}</span>{" "}
                        {item.entityTitle || item.entityId}
                      </div>
                      <div className="ri-sub">
                        {item.projectName || item.projectId}
                        {loc}
                        {cascText} · 删除于 {fmtFullTime(item.deletedAt)}
                      </div>
                    </div>
                    <div className="ri-side">
                      <button
                        type="button"
                        className="btn-ghost btn-ghost-sm"
                        disabled={restore.isPending}
                        onClick={() => onRestore(item)}
                      >
                        恢复
                      </button>
                      <button
                        type="button"
                        className="btn-danger px-3 py-1.5 text-xs"
                        disabled={purge.isPending}
                        onClick={() => onPurge(item)}
                      >
                        彻底删除
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
