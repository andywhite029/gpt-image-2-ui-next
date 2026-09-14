"use client";

// 项目概览：头部 + 统计卡 + 分类网格（拖拽排序）+ 最近对话 + 最近图片

import { use, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { endpoints, errorText } from "@/lib/api-client";
import { useProjectOverview } from "@/hooks/use-projects";
import { useModal } from "@/components/ui/modal";
import { ViewHeader, Loading, ErrorBox, Empty } from "@/components/ui/empty";
import { ProjectTypeTag } from "@/components/ui/badge";
import { ImageGrid } from "@/components/gallery/image-grid";
import { Lightbox } from "@/components/gallery/lightbox";
import { fmtFullTime } from "@/lib/format";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/hooks/use-projects";

export default function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ pid: string }>;
}) {
  const { pid } = use(params);
  const router = useRouter();
  const modal = useModal();
  const qc = useQueryClient();
  const { data, isLoading, error } = useProjectOverview(pid);
  const [lightboxId, setLightboxId] = useState<string | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["projects"] });
    qc.invalidateQueries({ queryKey: queryKeys.projectOverview(pid) });
    qc.invalidateQueries({ queryKey: ["conversations"] });
  };

  if (isLoading) return <Loading text="加载项目总览…" />;
  if (error || !data)
    return (
      <ErrorBox message={"加载失败：" + (error ? errorText(error) : "项目不存在")}>
        <button type="button" className="btn-ghost btn-ghost-sm mt-2" onClick={() => router.push("/")}>
          返回首页
        </button>
      </ErrorBox>
    );

  const project = data.project;
  const cats = data.categories ?? [];
  const stats = data.stats;
  const recentConvs = data.recentConversations ?? [];
  const recentImages = data.recentImages ?? [];

  const openEditProject = () => {
    modal.openModal({
      title: "编辑项目",
      body: <EditProjectForm project={project} />,
      actions: [
        { label: "取消", kind: "ghost" },
        {
          label: "保存",
          kind: "primary",
          onClick: async () => {
            const form = document.getElementById("edit-project-form") as HTMLFormElement | null;
            if (!form) return false;
            const fd = new FormData(form);
            const name = String(fd.get("name") ?? "").trim();
            if (!name) {
              toast.error("项目名称不能为空");
              return false;
            }
            try {
              await endpoints.patchProject(pid, {
                name,
                description: String(fd.get("description") ?? "").trim(),
                hidden: fd.get("hidden") === "on",
              });
              toast.success("项目已更新");
              refresh();
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

  const openCreateCategory = async () => {
    const name = await modal.promptModal({ title: "新建分类", label: "分类名称", value: "" });
    if (name === null || !name.trim()) return;
    try {
      await endpoints.createCategory(pid, { name: name.trim() });
      toast.success("分类已创建");
      refresh();
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const openCreateConversation = () => {
    modal.openModal({
      title: "新建对话",
      body: <CreateConversationForm categories={cats} defaultCategoryId={null} />,
      actions: [
        { label: "取消", kind: "ghost" },
        {
          label: "创建",
          kind: "primary",
          onClick: async () => {
            const form = document.getElementById("create-conversation-form") as HTMLFormElement | null;
            if (!form) return false;
            const fd = new FormData(form);
            const title = String(fd.get("title") ?? "").trim();
            const categoryId = String(fd.get("category_id") ?? "") || null;
            try {
              const res = await endpoints.createConversation(pid, {
                title: title || undefined,
                category_id: categoryId,
              });
              toast.success("对话已创建");
              refresh();
              if (res.conversation) {
                router.push(`/projects/${pid}/conversation/${res.conversation.id}`);
              }
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

  const toggleArchived = async () => {
    try {
      await endpoints.patchProject(pid, { archived: !project.archived });
      toast.success(project.archived ? "已取消归档" : "项目已归档");
      refresh();
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  return (
    <div>
      <ViewHeader
        title={project.name}
        tags={<ProjectTypeTag type={project.type} />}
        desc={
          (project.description || "暂无描述") +
          (project.archived ? "（已归档）" : "") +
          (project.hidden ? "（已隐藏）" : "")
        }
        actions={
          <>
            <button type="button" className="btn-ghost btn-ghost-sm" onClick={openEditProject}>
              ✎ 编辑
            </button>
            <button type="button" className="btn-ghost btn-ghost-sm" onClick={toggleArchived}>
              {project.archived ? "取消归档" : "🗃 归档"}
            </button>
            <button type="button" className="btn-ghost btn-ghost-sm" onClick={openCreateCategory}>
              ＋ 分类
            </button>
            <button type="button" className="btn-ghost btn-ghost-sm" onClick={openCreateConversation}>
              ＋ 对话
            </button>
          </>
        }
      />

      {/* 统计卡 */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3.5">
        {(
          [
            ["对话", stats.conversations],
            ["图片", stats.images],
            ["参考图", stats.references],
            ["收藏", stats.favorites],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="card text-center">
            <div className="text-xs text-muted">{label}</div>
            <div className="mt-1.5 text-2xl font-bold">{value ?? 0}</div>
          </div>
        ))}
      </div>

      {/* 分类 */}
      <div className="section-title">分类（{cats.length}）</div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3.5">
        {cats.map((cat, i) => (
          <CategoryCard
            key={cat.id}
            pid={pid}
            category={cat}
            index={i}
            total={cats.length}
            onRefresh={refresh}
          />
        ))}
        <button
          type="button"
          className="flex min-h-[80px] cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-border2 bg-transparent text-sm text-muted transition-colors hover:border-accent hover:text-text"
          onClick={openCreateCategory}
        >
          ＋ 新建分类
        </button>
      </div>

      {/* 最近对话 */}
      <div className="section-title">最近对话</div>
      {!recentConvs.length ? (
        <Empty text="还没有对话，点击「＋ 对话」创建" />
      ) : (
        <div className="row-list">
          {recentConvs.map((c) => (
            <div
              key={c.id}
              className="row-item"
              onClick={() => router.push(`/projects/${pid}/conversation/${c.id}`)}
            >
              <div className="ri-main">
                <div className="ri-title">💬 {c.title || c.id}</div>
                <div className="ri-sub">更新于 {fmtFullTime(c.updatedAt)}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 最近图片 */}
      <div className="section-title">最近图片</div>
      <ImageGrid images={recentImages} onImageClick={(img) => setLightboxId(img.id)} emptyText="还没有图片" />

      {lightboxId && (
        <Lightbox
          imageId={lightboxId}
          siblingIds={recentImages.map((i) => i.id)}
          onClose={() => setLightboxId(null)}
          onOpenImage={setLightboxId}
          onGoConversation={(p, c) => router.push(`/projects/${p}/conversation/${c}`)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 分类卡片（拖拽排序）
// ---------------------------------------------------------------------------

function CategoryCard({
  pid,
  category,
  index,
  total,
  onRefresh,
}: {
  pid: string;
  category: { id: string; name: string };
  index: number;
  total: number;
  onRefresh: () => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const [dragOver, setDragOver] = useState(false);
  const dragIndexRef = useRef<number | null>(null);

  const reorder = async (from: number, to: number) => {
    // 从 query 缓存拿全量分类
    const cats = qc.getQueryData(queryKeys.categories(pid)) as
      | Array<{ id: string; name: string }>
      | undefined;
    if (!cats || from < 0 || to < 0 || from >= cats.length || to >= cats.length) return;
    const next = [...cats];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    try {
      await endpoints.reorderCategories(
        pid,
        next.map((c) => c.id)
      );
      toast.success("分类顺序已更新");
      onRefresh();
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  return (
    <div
      className={
        "card flex cursor-pointer items-center gap-2 transition-colors hover:border-accent " +
        (dragOver ? "outline-1 -outline-offset-1 outline-dashed outline-accent" : "")
      }
      draggable
      onDragStart={(e) => {
        dragIndexRef.current = index;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(index));
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const from = parseInt(e.dataTransfer.getData("text/plain"), 10);
        if (!isNaN(from)) reorder(from, index);
      }}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        router.push(`/projects/${pid}/category/${category.id}`);
      }}
    >
      <div className="min-w-0 flex-1 truncate text-[15px] font-semibold">📁 {category.name}</div>
      <div className="ml-auto flex shrink-0 gap-1">
        <button
          type="button"
          className="btn-ghost btn-ghost-sm"
          title="上移"
          disabled={index <= 0}
          onClick={() => reorder(index, index - 1)}
        >
          ⬆
        </button>
        <button
          type="button"
          className="btn-ghost btn-ghost-sm"
          title="下移"
          disabled={index >= total - 1}
          onClick={() => reorder(index, index + 1)}
        >
          ⬇
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 表单体
// ---------------------------------------------------------------------------

function EditProjectForm({
  project,
}: {
  project: { name: string; description: string; hidden: boolean };
}) {
  return (
    <form id="edit-project-form">
      <div className="field">
        <label className="field-label">项目名称</label>
        <input type="text" name="name" className="input-text" defaultValue={project.name} autoFocus />
      </div>
      <div className="field">
        <label className="field-label">描述</label>
        <textarea name="description" className="input-text" defaultValue={project.description} />
      </div>
      <label className="check">
        <input type="checkbox" name="hidden" defaultChecked={project.hidden} />
        隐藏项目（不在默认列表显示）
      </label>
    </form>
  );
}

function CreateConversationForm({
  categories,
  defaultCategoryId,
}: {
  categories: Array<{ id: string; name: string }>;
  defaultCategoryId: string | null;
}) {
  return (
    <form id="create-conversation-form">
      <div className="field">
        <label className="field-label">标题（可选，留空自动生成）</label>
        <input type="text" name="title" className="input-text" placeholder="新对话" autoFocus />
      </div>
      {categories.length > 0 && (
        <div className="field">
          <label className="field-label">所属分类</label>
          <select name="category_id" className="input-select" defaultValue={defaultCategoryId ?? ""}>
            <option value="">未分类</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </form>
  );
}
