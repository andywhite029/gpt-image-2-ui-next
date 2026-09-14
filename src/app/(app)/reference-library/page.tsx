"use client";

// 参考图库：按项目分组 + 上传弹窗 + 详情弹窗

import { useState } from "react";
import { toast } from "sonner";
import { useProjects } from "@/hooks/use-projects";
import { useReferences, usePatchReference, useDeleteReference } from "@/hooks/use-library";
import { useModal } from "@/components/ui/modal";
import { ViewHeader, Loading, Empty } from "@/components/ui/empty";
import { errorText, referenceFileUrl } from "@/lib/api-client";
import { fmtFullTime, formatBytes } from "@/lib/format";
import { useQueryClient } from "@tanstack/react-query";
import type { ReferenceSummary } from "@/types/entities";

export default function ReferenceLibraryPage() {
  const modal = useModal();
  const qc = useQueryClient();
  const { data: projects = [], isLoading } = useProjects(true);
  const [refreshTick, setRefreshTick] = useState(0);

  const openUpload = () => {
    if (!projects.length) {
      toast.error("请先创建项目");
      return;
    }
    modal.openModal({
      title: "上传参考图",
      body: (
        <form id="upload-ref-form">
          <div className="field">
            <label className="field-label">上传到项目</label>
            <select name="project_id" className="input-select">
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label">选择文件（可多选，PNG / JPEG / WebP，单张 ≤ 25 MB，最多 16 张）</label>
            <input
              type="file"
              name="files"
              className="input-text"
              accept="image/png,image/jpeg,image/webp"
              multiple
            />
          </div>
        </form>
      ),
      actions: [
        { label: "取消", kind: "ghost" },
        {
          label: "上传",
          kind: "primary",
          onClick: async () => {
            const form = document.getElementById("upload-ref-form") as HTMLFormElement | null;
            if (!form) return false;
            const fd = new FormData(form);
            const filesInput = form.querySelector<HTMLInputElement>('input[type="file"]');
            const files = filesInput?.files;
            if (!files || !files.length) {
              toast.error("请先选择文件");
              return false;
            }
            const pid = String(fd.get("project_id") ?? "");
            try {
              const res = await (
                await import("@/lib/api-client")
              ).endpoints.uploadReferences(pid, Array.from(files));
              toast.success(`已上传 ${res.references?.length ?? files.length} 张参考图`);
              qc.invalidateQueries({ queryKey: ["references"] });
              qc.invalidateQueries({ queryKey: ["projects"] });
              setRefreshTick((v) => v + 1);
              return true;
            } catch (e) {
              toast.error(errorText(e));
              return false;
            }
          },
        },
      ],
    });
  };

  return (
    <div>
      <ViewHeader
        title="参考图库"
        desc="上传即入参考图库；「生成来源」的图片来自历史生成。点击图片查看详情。"
        actions={
          <button type="button" className="btn-ghost btn-ghost-sm" onClick={openUpload}>
            ⬆ 上传参考图
          </button>
        }
      />
      {isLoading ? (
        <Loading text="加载参考图库…" />
      ) : !projects.length ? (
        <Empty text="请先创建项目，再上传参考图" />
      ) : (
        projects.map((p) => <ProjectRefSection key={p.id + refreshTick} pid={p.id} projectName={p.name} />)
      )}
    </div>
  );
}

function ProjectRefSection({ pid, projectName }: { pid: string; projectName: string }) {
  const { data: refs = [] } = useReferences(pid);
  if (!refs.length) return null;

  return (
    <div>
      <div className="section-title">
        {projectName}（{refs.length}）
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] items-start gap-2.5">
        {refs.map((ref) => (
          <RefCard key={ref.id} ref_={ref} />
        ))}
      </div>
    </div>
  );
}

function RefCard({ ref_ }: { ref_: ReferenceSummary }) {
  const modal = useModal();
  const patchRef = usePatchReference();
  const deleteRef = useDeleteReference();
  const qc = useQueryClient();

  const openDetail = () => {
    modal.openModal({
      title: ref_.name || ref_.id,
      wide: true,
      body: (
        <div>
          {!ref_.fileMissing && (
            <img
              src={referenceFileUrl(ref_.id)}
              alt={ref_.name}
              className="mb-3 w-full rounded-lg bg-black"
              onError={(e) => (e.currentTarget as HTMLImageElement).remove()}
            />
          )}
          <table className="meta-table">
            <tbody>
              <tr><th>名称</th><td>{ref_.name}</td></tr>
              <tr><th>类型</th><td>{ref_.type === "uploaded" ? "上传" : "生成来源"}</td></tr>
              <tr><th>大小</th><td>{formatBytes(ref_.fileSize) || "—"}</td></tr>
              <tr><th>备注</th><td>{ref_.userNote || "—"}</td></tr>
              <tr><th>标签</th><td>{ref_.tags?.join("、") || "—"}</td></tr>
              <tr><th>时间</th><td>{fmtFullTime(ref_.createdAt)}</td></tr>
            </tbody>
          </table>
        </div>
      ),
      actions: [
        ...(ref_.type === "uploaded"
          ? [
              {
                label: "改名",
                kind: "ghost" as const,
                onClick: async () => {
                  const name = await modal.promptModal({
                    title: "重命名参考图",
                    label: "名称（不改文件名）",
                    value: ref_.name,
                  });
                  if (name === null || !name.trim()) return false;
                  try {
                    await patchRef.mutateAsync({ rid: ref_.id, name: name.trim() });
                    toast.success("已重命名");
                    qc.invalidateQueries({ queryKey: ["references"] });
                    return true;
                  } catch (e) {
                    toast.error(errorText(e));
                    return false;
                  }
                },
              },
            ]
          : []),
        {
          label: "编辑备注/标签",
          kind: "ghost",
          onClick: async () => {
            const note = await modal.promptModal({
              title: "编辑备注",
              label: "备注",
              value: ref_.userNote ?? "",
              textarea: true,
            });
            if (note === null) return false;
            const tagsVal = await modal.promptModal({
              title: "编辑标签",
              label: "多个标签用逗号分隔",
              value: (ref_.tags ?? []).join(", "),
            });
            if (tagsVal === null) return false;
            try {
              await patchRef.mutateAsync({
                rid: ref_.id,
                user_note: note.trim(),
                tags: tagsVal.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
              });
              toast.success("已更新");
              qc.invalidateQueries({ queryKey: ["references"] });
              return true;
            } catch (e) {
              toast.error(errorText(e));
              return false;
            }
          },
        },
        {
          label: ref_.isFavorited ? "取消收藏" : "收藏",
          kind: "ghost",
          onClick: async () => {
            try {
              await patchRef.mutateAsync({ rid: ref_.id, is_favorited: !ref_.isFavorited });
              toast.success("已更新");
              qc.invalidateQueries({ queryKey: ["references"] });
              return true;
            } catch (e) {
              toast.error(errorText(e));
              return false;
            }
          },
        },
        {
          label: "删除",
          kind: "danger",
          onClick: async () => {
            const ok = await modal.confirmModal({
              title: "删除参考图",
              message: "参考图将移入回收站；「生成来源」的参考图删除不影响原图片资产和历史记录。确定删除吗？",
              danger: true,
              confirmText: "移入回收站",
            });
            if (!ok) return false;
            try {
              await deleteRef.mutateAsync(ref_.id);
              toast.success("已移入回收站");
              qc.invalidateQueries({ queryKey: ["references"] });
              qc.invalidateQueries({ queryKey: ["trash"] });
              return true;
            } catch (e) {
              toast.error(errorText(e));
              return false;
            }
          },
        },
      ],
    });
  };

  return (
    <div
      className={
        "relative cursor-pointer overflow-hidden rounded-lg border border-border bg-panel2 transition-colors hover:border-accent " +
        (ref_.fileMissing ? "opacity-60" : "")
      }
      title={ref_.name || ref_.id}
      onClick={openDetail}
    >
      {!ref_.fileMissing ? (
        <img
          src={referenceFileUrl(ref_.id)}
          alt={ref_.name || ref_.id}
          loading="lazy"
          className="block h-auto w-full"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).replaceWith(
              Object.assign(document.createElement("div"), {
                className: "flex min-h-[120px] items-center justify-center text-xs text-faint",
                textContent: "加载失败",
              })
            );
          }}
        />
      ) : (
        <div className="flex min-h-[120px] items-center justify-center text-xs text-faint">文件缺失</div>
      )}
      {ref_.isFavorited && (
        <span className="absolute top-1.5 right-1.5 text-[15px] text-warn">★</span>
      )}
      <span className="absolute bottom-0 left-0 right-0 truncate bg-[linear-gradient(transparent,rgba(0,0,0,0.75))] px-2 py-1 text-[11px] text-muted">
        {(ref_.type === "uploaded" ? "⬆ 上传 · " : "🎨 生成 · ") + (ref_.name || ref_.id)}
      </span>
    </div>
  );
}
