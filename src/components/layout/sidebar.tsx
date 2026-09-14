"use client";

// 侧栏 240px：全局导航 + 项目树（项目→分类+未分类→对话）+ 新建项目

import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { endpoints, errorText } from "@/lib/api-client";
import { useProjects } from "@/hooks/use-projects";
import { useCategories, useConversations } from "@/hooks/use-conversation";
import { useUI } from "@/app/providers";
import { useModal } from "@/components/ui/modal";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/hooks/use-projects";
import type { Category, Conversation, Project } from "@/types/entities";

const GLOBAL_ENTRIES = [
  { href: "/all-images", ico: "🖼", label: "全部图片" },
  { href: "/favorites", ico: "⭐", label: "收藏" },
  { href: "/reference-library", ico: "🧩", label: "参考图库" },
  { href: "/uncategorized", ico: "🗂", label: "未分类" },
  { href: "/trash", ico: "🗑", label: "回收站" },
  { href: "/templates", ico: "📋", label: "模板" },
];

// ---------------------------------------------------------------------------
// 新建项目弹窗
// ---------------------------------------------------------------------------

function useCreateProjectModal() {
  const modal = useModal();
  const qc = useQueryClient();
  const router = useRouter();

  return () =>
    modal.openModal({
      title: "新建项目",
      body: <CreateProjectBody />,
      actions: [
        { label: "取消", kind: "ghost" },
        {
          label: "创建",
          kind: "primary",
          onClick: async () => {
            const form = document.getElementById("create-project-form") as HTMLFormElement | null;
            if (!form) return false;
            const fd = new FormData(form);
            const name = String(fd.get("name") ?? "").trim();
            if (!name) {
              toast.error("项目名称不能为空");
              return false;
            }
            try {
              const res = await endpoints.createProject({
                name,
                type: String(fd.get("type") ?? "free_creation"),
                description: String(fd.get("description") ?? "").trim(),
              });
              toast.success("项目已创建");
              qc.invalidateQueries({ queryKey: ["projects"] });
              const project = res.project;
              if (project) {
                router.push(`/projects/${project.id}`);
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
}

function CreateProjectBody() {
  return (
    <form id="create-project-form">
      <div className="field">
        <label className="field-label">项目名称</label>
        <input type="text" name="name" className="input-text" placeholder="例如：科幻短片" autoFocus />
      </div>
      <div className="field">
        <label className="field-label">项目类型</label>
        <select name="type" className="input-select">
          <option value="video_project">视频工程（自动创建 角色参考/场景参考/分镜图/风格参考 四个分类）</option>
          <option value="free_creation">自由创作（仅创建初始对话）</option>
        </select>
      </div>
      <div className="field">
        <label className="field-label">描述（可选）</label>
        <textarea name="description" className="input-text" placeholder="这个项目要做什么…" />
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// 侧栏主体
// ---------------------------------------------------------------------------

export function Sidebar({ mobileOnly = false }: { mobileOnly?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const modal = useModal();
  const qc = useQueryClient();
  const { mobileSidebarOpen, setMobileSidebarOpen, generatingConversationIds } = useUI();
  const { data: projects = [], isLoading } = useProjects(true);
  const openCreateProject = useCreateProjectModal();

  // 展开状态（内存 Set）
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  const onNavClick = () => {
    if (typeof window !== "undefined" && window.innerWidth < 900) {
      setMobileSidebarOpen(false);
    }
  };

  const toggleExpand = (pid: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  };

  return (
    <>
      {/* 移动端 scrim */}
      {mobileSidebarOpen && mobileOnly && (
        <div
          className="fixed top-[52px] right-0 bottom-0 left-0 z-[24] bg-[rgba(5,7,10,0.55)] md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}
      <aside
        aria-label="侧边导航"
        className={
          "z-[25] flex w-[240px] shrink-0 flex-col overflow-y-auto overflow-x-hidden border-r border-border bg-panel transition-[margin] duration-200 " +
          (mobileOnly
            ? // 移动端实例：fixed overlay，始终渲染（用 margin 控制显隐）
              "fixed top-[52px] bottom-0 left-0 shadow-2xl md:hidden " +
              (mobileSidebarOpen ? "ml-0" : "ml-[-240px]")
            : // 桌面端实例：普通流内布局
              "max-[900px]:hidden")
        }
      >
        {/* 全局导航 */}
        <div className="px-2 pt-2.5 pb-1">
          {GLOBAL_ENTRIES.map((entry) => (
            <a
              key={entry.href}
              href={entry.href}
              className={
                "flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-text hover:bg-panel2 hover:no-underline " +
                (isActive(entry.href) ? "bg-panel3" : "")
              }
              onClick={onNavClick}
            >
              <span className="w-[18px] shrink-0 text-center">{entry.ico}</span>
              <span>{entry.label}</span>
            </a>
          ))}
        </div>

        {/* 项目树 */}
        <div className="flex flex-1 flex-col px-1.5">
          <div className="flex items-center justify-between px-2.5 pt-1 pb-1.5 text-[11px] font-semibold tracking-widest text-faint uppercase">
            <span>项目</span>
            <span>{projects.length}</span>
          </div>
          <div className="flex-1 px-1.5 pb-3">
            {isLoading ? (
              <div className="px-2 py-4 text-xs text-faint">加载中…</div>
            ) : !projects.length ? (
              <div className="px-2 py-4 text-xs leading-relaxed text-faint">
                还没有项目，点击下方「新建项目」开始
              </div>
            ) : (
              projects.map((p) => (
                <ProjectNode
                  key={p.id}
                  project={p}
                  expanded={expanded.has(p.id)}
                  onToggle={() => toggleExpand(p.id)}
                  pathname={pathname}
                  generatingIds={generatingConversationIds}
                  onNavClick={onNavClick}
                />
              ))
            )}
          </div>
        </div>

        {/* 底部新建项目 */}
        <div className="border-t border-border p-2">
          <button
            type="button"
            className="w-full cursor-pointer rounded-lg border border-dashed border-border2 bg-transparent px-0 py-2.5 text-[13px] text-muted transition-colors hover:border-accent hover:text-text"
            onClick={openCreateProject}
          >
            ＋ 新建项目
          </button>
        </div>
      </aside>
    </>
  );
}

// ---------------------------------------------------------------------------
// 项目节点
// ---------------------------------------------------------------------------

function ProjectNode({
  project,
  expanded,
  onToggle,
  pathname,
  generatingIds,
  onNavClick,
}: {
  project: Project;
  expanded: boolean;
  onToggle: () => void;
  pathname: string;
  generatingIds: Set<string>;
  onNavClick: () => void;
}) {
  const modal = useModal();
  const qc = useQueryClient();
  const router = useRouter();
  const { data: categories = [] } = useCategories(project.id);
  const { data: conversations = [] } = useConversations(project.id);
  const projectHref = `/projects/${project.id}`;
  const active = pathname === projectHref || pathname.startsWith(projectHref + "/");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["projects"] });
    qc.invalidateQueries({ queryKey: ["categories"] });
    qc.invalidateQueries({ queryKey: ["conversations"] });
    qc.invalidateQueries({ queryKey: ["project"] });
  };

  const patchProject = async (d: { hidden?: boolean; archived?: boolean; name?: string }) => {
    try {
      await endpoints.patchProject(project.id, d);
      toast.success("已更新");
      refresh();
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  return (
    <div className="mb-0.5">
      <div
        className={
          "group flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] text-text hover:bg-panel2 " +
          (active ? "bg-panel3" : "")
        }
        onClick={onNavClick}
        role="link"
        onClickCapture={(e) => {
          // 点击行主体跳转项目页
          if ((e.target as HTMLElement).closest("[data-op]")) return;
          router.push(projectHref);
        }}
      >
        <span
          className={
            "w-3.5 shrink-0 text-center text-[10px] text-faint transition-transform " +
            (expanded ? "rotate-90" : "")
          }
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
        >
          ▶
        </span>
        <span className="min-w-0 flex-1 truncate">{project.name}</span>

        {/* hover 时显示 tag（截断），hover 出操作按钮 */}
        <span className="hidden shrink-0 items-center gap-1 group-hover:hidden">
          {project.type === "video_project" && (
            <span className="rounded border border-[rgba(0,158,250,0.4)] bg-panel3 px-1.5 py-px text-[10px] text-accent">
              视频
            </span>
          )}
          {project.hidden && <span className="tag">已隐藏</span>}
          {project.archived && <span className="tag">已归档</span>}
        </span>

        <span className="hidden shrink-0 items-center gap-0.5 group-hover:inline-flex">
          <TreeOp
            title="新建分类"
            onClick={async () => {
              const name = await modal.promptModal({ title: "新建分类", label: "分类名称", value: "" });
              if (name === null || !name.trim()) return;
              try {
                await endpoints.createCategory(project.id, { name: name.trim() });
                toast.success("分类已创建");
                refresh();
              } catch (e) {
                toast.error(errorText(e));
              }
            }}
          >
            ＋
          </TreeOp>
          <TreeOp
            title="重命名项目"
            onClick={async () => {
              const name = await modal.promptModal({
                title: "重命名项目",
                label: "项目名称",
                value: project.name,
              });
              if (name === null || !name.trim() || name.trim() === project.name) return;
              await patchProject({ name: name.trim() });
            }}
          >
            ✎
          </TreeOp>
          <TreeOp
            title={project.hidden ? "取消隐藏" : "隐藏项目"}
            onClick={() => patchProject({ hidden: !project.hidden })}
          >
            👁
          </TreeOp>
          <TreeOp
            title={project.archived ? "取消归档" : "归档项目"}
            onClick={() => patchProject({ archived: !project.archived })}
          >
            🗃
          </TreeOp>
        </span>
      </div>

      {expanded && (
        <div className="ml-3.5 border-l border-border pl-1.5">
          {categories.map((cat) => (
            <CategoryNode
              key={cat.id}
              project={project}
              category={cat}
              categories={categories}
              conversations={conversations}
              pathname={pathname}
              generatingIds={generatingIds}
              onNavClick={onNavClick}
            />
          ))}
          <UncategorizedNode
            project={project}
            conversations={conversations.filter((c) => !c.categoryId)}
            pathname={pathname}
            generatingIds={generatingIds}
            onNavClick={onNavClick}
          />
        </div>
      )}
    </div>
  );
}

function TreeOp({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-op
      title={title}
      aria-label={title}
      className="flex size-[22px] cursor-pointer items-center justify-center rounded border-none bg-transparent px-0 text-xs text-muted hover:bg-panel3 hover:text-text"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// 分类节点（可拖拽排序）
// ---------------------------------------------------------------------------

function CategoryNode({
  project,
  category,
  categories,
  conversations,
  pathname,
  generatingIds,
  onNavClick,
}: {
  project: Project;
  category: Category;
  categories: Category[];
  conversations: Conversation[];
  pathname: string;
  generatingIds: Set<string>;
  onNavClick: () => void;
}) {
  const modal = useModal();
  const qc = useQueryClient();
  const router = useRouter();
  const [dragOver, setDragOver] = useState(false);
  const href = `/projects/${project.id}/category/${category.id}`;
  const active = pathname === href;
  const catConvs = conversations.filter((c) => c.categoryId === category.id);

  const reorder = async (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= categories.length || to >= categories.length) return;
    const next = [...categories];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    try {
      await endpoints.reorderCategories(
        project.id,
        next.map((c) => c.id)
      );
      qc.invalidateQueries({ queryKey: queryKeys.categories(project.id) });
      qc.invalidateQueries({ queryKey: ["project"] });
      toast.success("分类顺序已更新");
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const index = categories.findIndex((c) => c.id === category.id);

  return (
    <div className="mb-0.5">
      <div
        className={
          "group flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] text-text hover:bg-panel2 " +
          (active ? "bg-panel3 " : "") +
          (dragOver ? "outline-1 -outline-offset-1 outline-dashed outline-accent" : "")
        }
        draggable
        onDragStart={(e) => {
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
          if ((e.target as HTMLElement).closest("[data-op]")) return;
          onNavClick();
          router.push(href);
        }}
      >
        <span className="w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">📁 {category.name}</span>
        <span className="hidden shrink-0 items-center gap-0.5 group-hover:inline-flex">
          <TreeOp title="上移" onClick={() => reorder(index, index - 1)}>
            ⬆
          </TreeOp>
          <TreeOp title="下移" onClick={() => reorder(index, index + 1)}>
            ⬇
          </TreeOp>
          <TreeOp
            title="重命名分类"
            onClick={async () => {
              const name = await modal.promptModal({
                title: "重命名分类",
                label: "分类名称",
                value: category.name,
              });
              if (name === null || !name.trim() || name.trim() === category.name) return;
              try {
                await endpoints.patchCategory(category.id, { name: name.trim() });
                toast.success("分类已重命名");
                qc.invalidateQueries({ queryKey: queryKeys.categories(project.id) });
                qc.invalidateQueries({ queryKey: ["project"] });
              } catch (e) {
                toast.error(errorText(e));
              }
            }}
          >
            ✎
          </TreeOp>
        </span>
      </div>
      {/* 对话行 */}
      {catConvs.map((conv) => (
        <ConversationRow
          key={conv.id}
          project={project}
          conversation={conv}
          pathname={pathname}
          generating={generatingIds.has(conv.id)}
          onNavClick={onNavClick}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 未分类虚拟节点
// ---------------------------------------------------------------------------

function UncategorizedNode({
  project,
  conversations,
  pathname,
  generatingIds,
  onNavClick,
}: {
  project: Project;
  conversations: Conversation[];
  pathname: string;
  generatingIds: Set<string>;
  onNavClick: () => void;
}) {
  const router = useRouter();
  const href = `/projects/${project.id}/uncategorized`;
  const active = pathname === href;

  return (
    <div className="mb-0.5">
      <div
        className={
          "flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] text-text hover:bg-panel2 " +
          (active ? "bg-panel3" : "")
        }
        onClick={() => {
          onNavClick();
          router.push(href);
        }}
      >
        <span className="w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">🗂 未分类</span>
      </div>
      {conversations.map((conv) => (
        <ConversationRow
          key={conv.id}
          project={project}
          conversation={conv}
          pathname={pathname}
          generating={generatingIds.has(conv.id)}
          onNavClick={onNavClick}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 对话行
// ---------------------------------------------------------------------------

function ConversationRow({
  project,
  conversation,
  pathname,
  generating,
  onNavClick,
}: {
  project: Project;
  conversation: Conversation;
  pathname: string;
  generating: boolean;
  onNavClick: () => void;
}) {
  const modal = useModal();
  const qc = useQueryClient();
  const router = useRouter();
  const href = `/projects/${project.id}/conversation/${conversation.id}`;
  const active = pathname === href;

  return (
    <div
      className={
        "group flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] text-text hover:bg-panel2 " +
        (active ? "bg-panel3" : "")
      }
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("[data-op]")) return;
        onNavClick();
        router.push(href);
      }}
    >
      <span className="w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">💬 {conversation.title}</span>
      {generating && <span className="gen-dot" />}
      <span className="hidden shrink-0 items-center gap-0.5 group-hover:inline-flex">
        <TreeOp
          title="重命名对话"
          onClick={async () => {
            const title = await modal.promptModal({
              title: "重命名对话",
              label: "对话标题",
              value: conversation.title,
            });
            if (title === null || !title.trim() || title.trim() === conversation.title) return;
            try {
              await endpoints.patchConversation(conversation.id, { title: title.trim() });
              toast.success("对话已重命名");
              qc.invalidateQueries({ queryKey: ["conversations"] });
              qc.invalidateQueries({ queryKey: queryKeys.conversation(conversation.id) });
            } catch (e) {
              toast.error(errorText(e));
            }
          }}
        >
          ✎
        </TreeOp>
        <TreeOp
          title="删除对话"
          onClick={async () => {
            const ok = await modal.confirmModal({
              title: "删除对话",
              message: `对话「${conversation.title}」及其生成记录将移入回收站，可在回收站恢复。确定删除吗？`,
              danger: true,
              confirmText: "移入回收站",
            });
            if (!ok) return;
            try {
              await endpoints.deleteConversation(conversation.id);
              toast.success("对话已移入回收站");
              qc.invalidateQueries({ queryKey: ["conversations"] });
              qc.invalidateQueries({ queryKey: ["projects"] });
              qc.invalidateQueries({ queryKey: ["trash"] });
            } catch (e) {
              toast.error(errorText(e));
            }
          }}
        >
          🗑
        </TreeOp>
      </span>
    </div>
  );
}
