"use client";

// 侧栏 240px：全局导航 + 项目树（项目→分类+未分类→对话）+ 新建项目
// 支持：对话拖拽移动到其他项目/分类、悬停折叠项目自动展开、树展开动画、右键菜单

import { useRouter, usePathname } from "next/navigation";
import { createContext, useContext, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Archive,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  ListChecks,
  MessageSquare,
  MessageSquarePlus,
  Pencil,
  Plus,
  Puzzle,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { endpoints, errorText } from "@/lib/api-client";
import { useProjects } from "@/hooks/use-projects";
import { useCategories, useConversations, useMoveConversation } from "@/hooks/use-conversation";
import { useUI } from "@/app/providers";
import { useModal } from "@/components/ui/modal";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/components/ui/context-menu";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/hooks/use-projects";
import type { Category, Conversation, Project } from "@/types/entities";

const GLOBAL_ENTRIES = [
  { href: "/all-images", ico: ImageIcon, label: "全部图片" },
  { href: "/favorites", ico: Star, label: "收藏" },
  { href: "/reference-library", ico: Puzzle, label: "参考图库" },
  { href: "/uncategorized", ico: FolderOpen, label: "未分类" },
  { href: "/trash", ico: Trash2, label: "回收站" },
  { href: "/templates", ico: ListChecks, label: "模板" },
];

// ---------------------------------------------------------------------------
// 拖拽移动：自定义 MIME 类型，与分类排序（text/plain）、文件拖放互不干扰
// ---------------------------------------------------------------------------

const CONV_MOVE_MIME = "application/x-gptimg2-conv-move";

interface ConvDragPayload {
  cid: string;
  pid: string;
}

const isConvDrag = (e: React.DragEvent) =>
  Array.from(e.dataTransfer.types).includes(CONV_MOVE_MIME);

const readConvDrag = (e: React.DragEvent): ConvDragPayload | null => {
  try {
    const raw = e.dataTransfer.getData(CONV_MOVE_MIME);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConvDragPayload;
    if (typeof parsed.cid === "string" && typeof parsed.pid === "string") return parsed;
    return null;
  } catch {
    return null;
  }
};

interface ConvDragContextValue {
  draggingCid: string | null;
  beginDrag: (cid: string) => void;
  endDrag: () => void;
  /** 拖放成功后的移动处理（toast / 展开 / URL 替换） */
  onDropConversation: (payload: ConvDragPayload, targetPid: string, targetCatId: string | null, label: string) => void;
}

const ConvDragContext = createContext<ConvDragContextValue | null>(null);

function useConvDrag(): ConvDragContextValue {
  const ctx = useContext(ConvDragContext);
  if (!ctx) throw new Error("useConvDrag 必须在 ConvDragContext 内使用");
  return ctx;
}

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
  const qc = useQueryClient();
  const { mobileSidebarOpen, setMobileSidebarOpen, generatingConversationIds } = useUI();
  const { data: projects = [], isLoading } = useProjects(true);
  const openCreateProject = useCreateProjectModal();
  const move = useMoveConversation();
  const { menu, openMenu, closeMenu } = useContextMenu();

  // 展开状态（内存 Set）
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // 已挂载状态：展开过一次的项目保持子树挂载（用于展开/收起动画）
  const [mounted, setMounted] = useState<Set<string>>(new Set());
  // 拖拽中的对话 id
  const [draggingCid, setDraggingCid] = useState<string | null>(null);

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
    setMounted((prev) => {
      if (prev.has(pid)) return prev;
      const next = new Set(prev);
      next.add(pid);
      return next;
    });
  };

  const expandProject = (pid: string) => {
    setExpanded((prev) => (prev.has(pid) ? prev : new Set(prev).add(pid)));
    setMounted((prev) => {
      if (prev.has(pid)) return prev;
      const next = new Set(prev);
      next.add(pid);
      return next;
    });
  };

  const onDropConversation = (
    payload: ConvDragPayload,
    targetPid: string,
    targetCatId: string | null,
    label: string
  ) => {
    if (payload.cid && payload.pid === targetPid && targetCatId === null) {
      // 同项目拖到项目头 = 无变化（区分拖到分类头）
    }
    move.mutate(
      { cid: payload.cid, project_id: targetPid, category_id: targetCatId },
      {
        onSuccess: (res) => {
          if (!res.moved) {
            toast("对话已在目标位置");
            return;
          }
          toast.success(`已移动到「${label}」`);
          expandProject(targetPid);
          // 当前正打开该对话时，替换为新路径
          if (pathname.startsWith(`/projects/${payload.pid}/conversation/${payload.cid}`)) {
            router.replace(`/projects/${targetPid}/conversation/${payload.cid}`);
          }
        },
        onError: (e) => toast.error(errorText(e)),
      }
    );
  };

  const dragContext: ConvDragContextValue = {
    draggingCid,
    beginDrag: (cid) => setDraggingCid(cid),
    endDrag: () => setDraggingCid(null),
    onDropConversation,
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
          {GLOBAL_ENTRIES.map((entry) => {
            const Ico = entry.ico;
            return (
              <a
                key={entry.href}
                href={entry.href}
                className={
                  "flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-text transition-colors hover:bg-panel2 hover:no-underline " +
                  (isActive(entry.href) ? "bg-panel3" : "")
                }
                onClick={onNavClick}
              >
                <Ico size={15} strokeWidth={1.8} className="shrink-0 text-muted" />
                <span>{entry.label}</span>
              </a>
            );
          })}
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
              <ConvDragContext.Provider value={dragContext}>
                {projects.map((p) => (
                  <ProjectNode
                    key={p.id}
                    project={p}
                    expanded={expanded.has(p.id)}
                    everExpanded={mounted.has(p.id)}
                    onToggle={() => toggleExpand(p.id)}
                    pathname={pathname}
                    generatingIds={generatingConversationIds}
                    onNavClick={onNavClick}
                    openMenu={openMenu}
                  />
                ))}
                <ContextMenu menu={menu} onClose={closeMenu} />
              </ConvDragContext.Provider>
            )}
          </div>
        </div>

        {/* 底部新建项目 */}
        <div className="border-t border-border p-2">
          <button
            type="button"
            className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-border2 bg-transparent px-0 py-2.5 text-[13px] text-muted transition-colors hover:border-accent hover:text-text"
            onClick={openCreateProject}
          >
            <Plus size={14} strokeWidth={1.8} />
            新建项目
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
  everExpanded,
  onToggle,
  pathname,
  generatingIds,
  onNavClick,
  openMenu,
}: {
  project: Project;
  expanded: boolean;
  everExpanded: boolean;
  onToggle: () => void;
  pathname: string;
  generatingIds: Set<string>;
  onNavClick: () => void;
  openMenu: (e: React.MouseEvent, items: ContextMenuItem[]) => void;
}) {
  const modal = useModal();
  const qc = useQueryClient();
  const router = useRouter();
  const drag = useConvDrag();
  const { data: categories = [] } = useCategories(project.id);
  const { data: conversations = [] } = useConversations(project.id);
  const [dropTarget, setDropTarget] = useState(false);
  const springTimer = useRef<number | null>(null);
  const projectHref = `/projects/${project.id}`;
  const active = pathname === projectHref || pathname.startsWith(projectHref + "/");

  const clearSpring = () => {
    if (springTimer.current != null) {
      window.clearTimeout(springTimer.current);
      springTimer.current = null;
    }
  };

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

  // 项目右键菜单
  const projectMenuItems = (e: React.MouseEvent) => {
    openMenu(e, [
      {
        label: "新建分类",
        icon: FolderPlus,
        onSelect: async () => {
          const name = await modal.promptModal({ title: "新建分类", label: "分类名称", value: "" });
          if (name === null || !name.trim()) return;
          try {
            await endpoints.createCategory(project.id, { name: name.trim() });
            toast.success("分类已创建");
            refresh();
          } catch (err) {
            toast.error(errorText(err));
          }
        },
      },
      {
        label: "重命名项目",
        icon: Pencil,
        onSelect: async () => {
          const name = await modal.promptModal({
            title: "重命名项目",
            label: "项目名称",
            value: project.name,
          });
          if (name === null || !name.trim() || name.trim() === project.name) return;
          await patchProject({ name: name.trim() });
        },
      },
      {
        label: project.hidden ? "取消隐藏" : "隐藏项目",
        icon: project.hidden ? Eye : EyeOff,
        onSelect: () => patchProject({ hidden: !project.hidden }),
      },
      {
        label: project.archived ? "取消归档" : "归档项目",
        icon: Archive,
        onSelect: () => patchProject({ archived: !project.archived }),
      },
    ]);
  };

  return (
    <div className="mb-0.5">
      <div
        className={
          "group flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] text-text transition-colors hover:bg-panel2 " +
          (active ? "bg-panel3 " : "") +
          (dropTarget ? "drop-target-active" : "")
        }
        onClick={onNavClick}
        role="link"
        onContextMenu={projectMenuItems}
        onClickCapture={(e) => {
          // 点击行主体跳转项目页
          if ((e.target as HTMLElement).closest("[data-op]")) return;
          router.push(projectHref);
        }}
        onDragOver={(e) => {
          if (!isConvDrag(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDropTarget(true);
          // 悬停折叠项目自动展开（spring-loading，仿 Finder）
          if (!expanded && springTimer.current == null) {
            springTimer.current = window.setTimeout(() => {
              springTimer.current = null;
              onToggle();
            }, 550);
          }
        }}
        onDragLeave={() => {
          setDropTarget(false);
          clearSpring();
        }}
        onDrop={(e) => {
          if (!isConvDrag(e)) return;
          e.preventDefault();
          clearSpring();
          setDropTarget(false);
          const payload = readConvDrag(e);
          if (payload) drag.onDropConversation(payload, project.id, null, project.name);
        }}
      >
        <span
          className={
            "w-3.5 shrink-0 text-center text-faint transition-transform duration-[var(--dur-fast)] " +
            (expanded ? "rotate-90" : "")
          }
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
        >
          <ChevronRight size={12} strokeWidth={2} className="mx-auto" />
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
            <FolderPlus size={14} strokeWidth={1.8} />
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
            <Pencil size={14} strokeWidth={1.8} />
          </TreeOp>
          <TreeOp
            title={project.hidden ? "取消隐藏" : "隐藏项目"}
            onClick={() => patchProject({ hidden: !project.hidden })}
          >
            {project.hidden ? <Eye size={14} strokeWidth={1.8} /> : <EyeOff size={14} strokeWidth={1.8} />}
          </TreeOp>
          <TreeOp
            title={project.archived ? "取消归档" : "归档项目"}
            onClick={() => patchProject({ archived: !project.archived })}
          >
            <Archive size={14} strokeWidth={1.8} />
          </TreeOp>
        </span>
      </div>

      {(expanded || everExpanded) && (
        <div className="tree-children" data-open={expanded ? "true" : "false"}>
          <div>
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
                  openMenu={openMenu}
                />
              ))}
              <UncategorizedNode
                project={project}
                conversations={conversations.filter((c) => !c.categoryId)}
                pathname={pathname}
                generatingIds={generatingIds}
                onNavClick={onNavClick}
                openMenu={openMenu}
              />
            </div>
          </div>
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
      className="flex size-[26px] cursor-pointer items-center justify-center rounded-md border-none bg-transparent px-0 text-muted transition-colors hover:bg-panel3 hover:text-text active:scale-90"
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
// 分类节点（可拖拽排序 + 对话拖放目标）
// ---------------------------------------------------------------------------

function CategoryNode({
  project,
  category,
  categories,
  conversations,
  pathname,
  generatingIds,
  onNavClick,
  openMenu,
}: {
  project: Project;
  category: Category;
  categories: Category[];
  conversations: Conversation[];
  pathname: string;
  generatingIds: Set<string>;
  onNavClick: () => void;
  openMenu: (e: React.MouseEvent, items: ContextMenuItem[]) => void;
}) {
  const modal = useModal();
  const qc = useQueryClient();
  const router = useRouter();
  const drag = useConvDrag();
  const [dragOver, setDragOver] = useState(false);
  const [convDragOver, setConvDragOver] = useState(false);
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

  const categoryMenuItems = (e: React.MouseEvent) => {
    openMenu(e, [
      {
        label: "重命名分类",
        icon: Pencil,
        onSelect: async () => {
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
          } catch (err) {
            toast.error(errorText(err));
          }
        },
      },
      { separator: true },
      {
        label: "删除分类",
        icon: Trash2,
        danger: true,
        onSelect: async () => {
          const ok = await modal.confirmModal({
            title: "删除分类",
            message: `分类「${category.name}」下的对话将移至未分类。确定删除吗？`,
            danger: true,
            confirmText: "删除",
          });
          if (!ok) return;
          try {
            await endpoints.deleteCategory(project.id, category.id);
            toast.success("分类已删除");
            qc.invalidateQueries({ queryKey: queryKeys.categories(project.id) });
            qc.invalidateQueries({ queryKey: ["conversations"] });
            qc.invalidateQueries({ queryKey: ["project"] });
            qc.invalidateQueries({ queryKey: ["projects"] });
          } catch (err) {
            toast.error(errorText(err));
          }
        },
      },
    ]);
  };

  return (
    <div className="mb-0.5">
      <div
        className={
          "group flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] text-text transition-colors hover:bg-panel2 " +
          (active ? "bg-panel3 " : "") +
          (convDragOver
            ? "drop-target-active "
            : dragOver
              ? "outline-1 -outline-offset-1 outline-dashed outline-accent"
              : "")
        }
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", String(index));
        }}
        onDragOver={(e) => {
          // 仅响应分类排序拖拽与对话移动拖拽（不拦系统文件拖入）
          const isCatReorder = Array.from(e.dataTransfer.types).includes("text/plain");
          if (!isConvDrag(e) && !isCatReorder) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (isConvDrag(e)) setConvDragOver(true);
          else setDragOver(true);
        }}
        onDragLeave={() => {
          setDragOver(false);
          setConvDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          setConvDragOver(false);
          if (isConvDrag(e)) {
            const payload = readConvDrag(e);
            if (payload) {
              drag.onDropConversation(payload, project.id, category.id, `${project.name} / ${category.name}`);
            }
            return;
          }
          const from = parseInt(e.dataTransfer.getData("text/plain"), 10);
          if (!isNaN(from)) reorder(from, index);
        }}
        onContextMenu={categoryMenuItems}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("[data-op]")) return;
          onNavClick();
          router.push(href);
        }}
      >
        <span className="w-3.5 shrink-0" />
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <Folder size={14} strokeWidth={1.8} className="shrink-0 text-muted" />
          <span className="truncate">{category.name}</span>
        </span>
        <span className="hidden shrink-0 items-center gap-0.5 group-hover:inline-flex">
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
            <Pencil size={14} strokeWidth={1.8} />
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
          openMenu={openMenu}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 未分类虚拟节点（对话拖放目标）
// ---------------------------------------------------------------------------

function UncategorizedNode({
  project,
  conversations,
  pathname,
  generatingIds,
  onNavClick,
  openMenu,
}: {
  project: Project;
  conversations: Conversation[];
  pathname: string;
  generatingIds: Set<string>;
  onNavClick: () => void;
  openMenu: (e: React.MouseEvent, items: ContextMenuItem[]) => void;
}) {
  const router = useRouter();
  const drag = useConvDrag();
  const [convDragOver, setConvDragOver] = useState(false);
  const href = `/projects/${project.id}/uncategorized`;
  const active = pathname === href;

  return (
    <div className="mb-0.5">
      <div
        className={
          "flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] text-text transition-colors hover:bg-panel2 " +
          (active ? "bg-panel3 " : "") +
          (convDragOver ? "drop-target-active" : "")
        }
        onDragOver={(e) => {
          if (!isConvDrag(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setConvDragOver(true);
        }}
        onDragLeave={() => setConvDragOver(false)}
        onDrop={(e) => {
          if (!isConvDrag(e)) return;
          e.preventDefault();
          setConvDragOver(false);
          const payload = readConvDrag(e);
          if (payload) drag.onDropConversation(payload, project.id, null, `${project.name} / 未分类`);
        }}
        onClick={() => {
          onNavClick();
          router.push(href);
        }}
      >
        <span className="w-3.5 shrink-0" />
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <FolderOpen size={14} strokeWidth={1.8} className="shrink-0 text-muted" />
          <span className="truncate">未分类</span>
        </span>
      </div>
      {conversations.map((conv) => (
        <ConversationRow
          key={conv.id}
          project={project}
          conversation={conv}
          pathname={pathname}
          generating={generatingIds.has(conv.id)}
          onNavClick={onNavClick}
          openMenu={openMenu}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 对话行（拖拽源：拖到项目/分类/未分类节点上移动）
// ---------------------------------------------------------------------------

function ConversationRow({
  project,
  conversation,
  pathname,
  generating,
  onNavClick,
  openMenu,
}: {
  project: Project;
  conversation: Conversation;
  pathname: string;
  generating: boolean;
  onNavClick: () => void;
  openMenu: (e: React.MouseEvent, items: ContextMenuItem[]) => void;
}) {
  const modal = useModal();
  const qc = useQueryClient();
  const router = useRouter();
  const drag = useConvDrag();
  const href = `/projects/${project.id}/conversation/${conversation.id}`;
  const active = pathname === href;
  const dragging = drag.draggingCid === conversation.id;

  const renameConversation = async () => {
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
  };

  const deleteConversation = async () => {
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
  };

  const conversationMenuItems = (e: React.MouseEvent) => {
    openMenu(e, [
      { label: "重命名对话", icon: Pencil, onSelect: renameConversation },
      {
        label: "复制对话 ID",
        icon: Copy,
        onSelect: () => {
          navigator.clipboard?.writeText(conversation.id).then(
            () => toast.success("已复制"),
            () => toast.error("复制失败")
          );
        },
      },
      { separator: true },
      { label: "删除对话", icon: Trash2, danger: true, onSelect: deleteConversation },
    ]);
  };

  return (
    <div
      className={
        "group flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] text-text transition-colors hover:bg-panel2 " +
        (active ? "bg-panel3 " : "") +
        (dragging ? "opacity-40" : "")
      }
      draggable
      onDragStart={(e) => {
        if (generating) {
          // 生成中的对话不允许移动（文件写入使用提交时的项目路径）
          e.preventDefault();
          toast.error("该对话正在生成中，完成后才能移动");
          return;
        }
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(
          CONV_MOVE_MIME,
          JSON.stringify({ cid: conversation.id, pid: project.id } satisfies ConvDragPayload)
        );
        drag.beginDrag(conversation.id);
      }}
      onDragEnd={() => drag.endDrag()}
      onContextMenu={conversationMenuItems}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("[data-op]")) return;
        onNavClick();
        router.push(href);
      }}
    >
      <span className="w-3.5 shrink-0" />
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <MessageSquare size={14} strokeWidth={1.8} className="shrink-0 text-muted" />
        <span className="truncate">{conversation.title}</span>
      </span>
      {generating && <span className="gen-dot" />}
      <span className="hidden shrink-0 items-center gap-0.5 group-hover:inline-flex">
        <TreeOp title="重命名对话" onClick={renameConversation}>
          <Pencil size={14} strokeWidth={1.8} />
        </TreeOp>
        <TreeOp title="删除对话" onClick={deleteConversation}>
          <Trash2 size={14} strokeWidth={1.8} />
        </TreeOp>
      </span>
    </div>
  );
}
