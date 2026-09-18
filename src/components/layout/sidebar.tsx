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
  FolderInput,
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
import { useQueryClient, useQueries } from "@tanstack/react-query";
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
  /** 被拖对话当前所属 (pid, categoryId)，目标据此显示「无效/已在此处」状态 */
  draggingFrom: { pid: string; categoryId: string | null } | null;
  beginDrag: (cid: string, pid: string, categoryId: string | null) => void;
  endDrag: () => void;
  /** 拖放成功后的移动处理（toast / 展开 / URL 替换） */
  onDropConversation: (payload: ConvDragPayload, targetPid: string, targetCatId: string | null, label: string) => void;
  /** 右键「移动到…」菜单数据：全部项目（含分类）与移动动作 */
  allProjects: Array<{ id: string; name: string; categories: Array<{ id: string; name: string }> }>;
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
  // 拖拽中的对话 id 与其当前位置
  const [draggingCid, setDraggingCid] = useState<string | null>(null);
  const [draggingFrom, setDraggingFrom] = useState<{ pid: string; categoryId: string | null } | null>(null);

  // 右键「移动到…」需要所有项目的分类清单；一次性拉全部项目的分类
  // （项目数通常个位数，与 ProjectNode 内的 useCategories 共享 query 缓存，无额外请求）
  const allCategories = useQueries({
    queries: projects.map((p) => ({
      queryKey: queryKeys.categories(p.id),
      queryFn: () => endpoints.categories(p.id).then((d) => d.categories ?? []),
    })),
  });
  const allProjects = projects.map((p, i) => ({
    id: p.id,
    name: p.name,
    categories: allCategories[i]?.data ?? [],
  }));

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
    // 同项目拖到项目头 = 保持原分类，仅跨项目时项目头才代表「未分类」
    const effectiveCatId = payload.pid === targetPid && targetCatId === null ? undefined : targetCatId;
    if (effectiveCatId === undefined) {
      // 同项目拖到项目头：无变化，不请求
      toast("对话已在当前项目内，拖到具体分类可改变归属");
      return;
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
    draggingFrom,
    beginDrag: (cid, pid, categoryId) => {
      setDraggingCid(cid);
      setDraggingFrom({ pid, categoryId });
    },
    endDrag: () => {
      setDraggingCid(null);
      setDraggingFrom(null);
    },
    onDropConversation,
    allProjects,
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
                    onExpand={() => expandProject(p.id)}
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
  onExpand,
  pathname,
  generatingIds,
  onNavClick,
  openMenu,
}: {
  project: Project;
  expanded: boolean;
  everExpanded: boolean;
  onToggle: () => void;
  onExpand: () => void;
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
  // 同项目且非跨分类拖拽时，项目头是无效目标（对话已在该项目内）
  const isNoopTarget =
    !!drag.draggingFrom && drag.draggingFrom.pid === project.id;

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
        label: "新建对话",
        icon: MessageSquarePlus,
        onSelect: async () => {
          try {
            const res = await endpoints.createConversation(project.id, { title: undefined, category_id: null });
            toast.success("对话已创建（未分类）");
            qc.invalidateQueries({ queryKey: ["conversations"] });
            qc.invalidateQueries({ queryKey: ["projects"] });
            onExpand();
            if (res.conversation) {
              router.push(`/projects/${project.id}/conversation/${res.conversation.id}`);
            }
          } catch (err) {
            toast.error(errorText(err));
          }
        },
      },
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
          (dropTarget
            ? isNoopTarget
              ? "drop-target-noop"
              : "drop-target-active"
            : "")
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
          e.stopPropagation();
          e.dataTransfer.dropEffect = isNoopTarget ? "none" : "move";
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
          if (isNoopTarget) return;
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
  // 对话已在该分类 → 无效目标（显示禁用态而非成功态）
  const isNoopTarget =
    !!drag.draggingFrom &&
    drag.draggingFrom.pid === project.id &&
    drag.draggingFrom.categoryId === category.id;

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
          "group flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted transition-colors hover:bg-panel2 hover:text-text " +
          (active ? "bg-panel3 text-text " : "") +
          (convDragOver
            ? isNoopTarget
              ? "drop-target-noop"
              : "drop-target-active "
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
          e.stopPropagation();
          e.dataTransfer.dropEffect = isConvDrag(e) && isNoopTarget ? "none" : "move";
          if (isConvDrag(e)) setConvDragOver(true);
          else setDragOver(true);
        }}
        onDragLeave={(e) => {
          // 子元素（对话行）间的移动不算离开
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setDragOver(false);
          setConvDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          setConvDragOver(false);
          if (isConvDrag(e)) {
            if (isNoopTarget) return;
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
      {/* 对话行（连同行区域整体作为分类 drop 区，拖到行上=移入该分类） */}
      <div
        onDragOver={(e) => {
          if (!isConvDrag(e)) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = isNoopTarget ? "none" : "move";
          setConvDragOver(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setConvDragOver(false);
        }}
        onDrop={(e) => {
          if (!isConvDrag(e)) return;
          e.preventDefault();
          setConvDragOver(false);
          if (isNoopTarget) return;
          const payload = readConvDrag(e);
          if (payload) {
            drag.onDropConversation(payload, project.id, category.id, `${project.name} / ${category.name}`);
          }
        }}
      >
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
  // 对话已是「该项目未分类」→ 无效目标
  const isNoopTarget =
    !!drag.draggingFrom &&
    drag.draggingFrom.pid === project.id &&
    drag.draggingFrom.categoryId === null;

  return (
    <div className="mb-0.5">
      <div
        className={
          "flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted transition-colors hover:bg-panel2 hover:text-text " +
          (active ? "bg-panel3 text-text " : "") +
          (convDragOver ? (isNoopTarget ? "drop-target-noop" : "drop-target-active") : "")
        }
        onDragOver={(e) => {
          if (!isConvDrag(e)) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = isNoopTarget ? "none" : "move";
          setConvDragOver(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setConvDragOver(false);
        }}
        onDrop={(e) => {
          if (!isConvDrag(e)) return;
          e.preventDefault();
          setConvDragOver(false);
          if (isNoopTarget) return;
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
      {/* 对话行（整体作为未分类 drop 区） */}
      <div
        onDragOver={(e) => {
          if (!isConvDrag(e)) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = isNoopTarget ? "none" : "move";
          setConvDragOver(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setConvDragOver(false);
        }}
        onDrop={(e) => {
          if (!isConvDrag(e)) return;
          e.preventDefault();
          setConvDragOver(false);
          if (isNoopTarget) return;
          const payload = readConvDrag(e);
          if (payload) drag.onDropConversation(payload, project.id, null, `${project.name} / 未分类`);
        }}
      >
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
  const rowRef = useRef<HTMLDivElement>(null);
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

  /** 右键「移动到…」：弹窗选择 项目+分类（拖拽的兜底交互） */
  const openMoveDialog = () => {
    modal.openModal({
      title: `移动对话「${conversation.title}」`,
      body: (
        <form
          id="move-conversation-form"
          // 切项目后重算分类下拉选项（modal body 用非受控 DOM 简化桥接）
          onInput={(e) => {
            const target = e.target as HTMLSelectElement;
            if (target.name !== "pid") return;
            const form = e.currentTarget;
            const pid = target.value;
            const catSel = form.elements.namedItem("category_id");
            if (!(catSel instanceof HTMLSelectElement)) return;
            const cats = drag.allProjects.find((p) => p.id === pid)?.categories ?? [];
            catSel.innerHTML =
              '<option value="">未分类</option>' +
              cats.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
            catSel.value = "";
          }}
        >
          <div className="field">
            <label className="field-label">目标项目</label>
            <select name="pid" className="input-select" defaultValue={project.id}>
              {drag.allProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label">目标分类</label>
            <select name="category_id" className="input-select" defaultValue={conversation.categoryId ?? ""}>
              <option value="">未分类</option>
              {(drag.allProjects.find((p) => p.id === project.id)?.categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </form>
      ),
      actions: [
        { label: "取消", kind: "ghost" },
        {
          label: "移动",
          kind: "primary",
          onClick: async () => {
            const form = document.getElementById("move-conversation-form") as HTMLFormElement | null;
            if (!form) return false;
            const fd = new FormData(form);
            const targetPid = String(fd.get("pid") ?? project.id);
            const targetCatId = String(fd.get("category_id") ?? "") || null;
            try {
              const res = await endpoints.moveConversation(conversation.id, {
                project_id: targetPid,
                category_id: targetCatId,
              });
              if (res.moved) {
                toast.success("对话已移动");
              } else {
                toast("对话已在目标位置");
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

  const conversationMenuItems = (e: React.MouseEvent) => {
    openMenu(e, [
      { label: "移动到…", icon: FolderInput, onSelect: openMoveDialog },
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
      ref={rowRef}
      className={
        "group flex min-w-0 cursor-grab items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-text transition-colors hover:bg-panel2 active:cursor-grabbing " +
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
        // 部分浏览器要求同时提供 text/plain 才能保证拖拽不中断
        e.dataTransfer.setData("text/plain", conversation.title);
        drag.beginDrag(conversation.id, project.id, conversation.categoryId ?? null);
      }}
      onDragEnd={() => drag.endDrag()}
      onContextMenu={conversationMenuItems}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("[data-op]")) return;
        onNavClick();
        router.push(href);
      }}
    >
      <span className="w-5 shrink-0" />
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <MessageSquare size={13} strokeWidth={1.8} className="shrink-0 text-faint" />
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
