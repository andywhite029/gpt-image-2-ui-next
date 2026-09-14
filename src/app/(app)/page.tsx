"use client";

// 首页：项目卡片网格 + 新建项目卡片

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useProjects } from "@/hooks/use-projects";
import { useModal } from "@/components/ui/modal";
import { ViewHeader, Empty, Loading, ErrorBox } from "@/components/ui/empty";
import { ProjectTypeTag } from "@/components/ui/badge";
import { errorText, endpoints } from "@/lib/api-client";

export default function HomePage() {
  const router = useRouter();
  const modal = useModal();
  const { data: projects = [], isLoading, error } = useProjects(true);
  const [lightboxId, setLightboxId] = useState<string | null>(null);

  if (isLoading) return <Loading text="加载项目…" />;
  if (error) return <ErrorBox message={"加载失败：" + errorText(error)} />;

  return (
    <div>
      <ViewHeader
        title="项目"
        desc="以「项目 → 分类 → 对话」组织创作过程，保留每轮生成的 Prompt、参数、参考图和结果。"
        actions={
          <button type="button" className="btn-ghost btn-ghost-sm" onClick={openCreateProject(modal, router)}>
            ＋ 新建项目
          </button>
        }
      />

      {!projects.length ? (
        <Empty text="还没有项目，点击「＋ 新建项目」开始">
          <button
            type="button"
            className="btn-primary mt-2"
            onClick={() => openCreateProject(modal, router)()}
          >
            ＋ 新建项目
          </button>
        </Empty>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3.5">
          {projects.map((p) => (
            <ProjectCard key={p.id} pid={p.id} onOpenImage={setLightboxId} />
          ))}
          <button
            type="button"
            className="flex min-h-[130px] cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-border2 bg-transparent text-sm text-muted transition-colors hover:border-accent hover:text-text"
            onClick={() => openCreateProject(modal, router)()}
          >
            ＋ 新建项目
          </button>
        </div>
      )}

      {lightboxId && <HomeLightbox imageId={lightboxId} onClose={() => setLightboxId(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 项目卡片：名称/类型 tag/描述/统计/最近 4 张缩略图
// ---------------------------------------------------------------------------

import { useProjectOverview } from "@/hooks/use-projects";
import { imageThumbUrl } from "@/lib/api-client";
import { Lightbox } from "@/components/gallery/lightbox";

function ProjectCard({
  pid,
  onOpenImage,
}: {
  pid: string;
  onOpenImage: (id: string) => void;
}) {
  const router = useRouter();
  const { data: project } = useProjects(true);
  const p = project?.find((x) => x.id === pid);
  const { data: overview } = useProjectOverview(pid);
  const counts: { conversations?: number; images?: number; references?: number } = p?.counts ?? {};

  const recentImages = (overview?.recentImages ?? []).slice(0, 4);

  return (
    <div
      className="flex cursor-pointer flex-col gap-2 rounded-xl border border-border bg-panel p-4 transition-all hover:-translate-y-px hover:border-accent"
      onClick={() => router.push(`/projects/${pid}`)}
    >
      <div className="flex items-center gap-2 text-[15px] font-semibold">
        <span className="min-w-0 flex-1 truncate">{p?.name ?? pid}</span>
        {p && <ProjectTypeTag type={p.type} />}
        {p?.archived && <span className="tag">已归档</span>}
        {p?.hidden && <span className="tag">已隐藏</span>}
      </div>
      <div className="line-clamp-2 min-h-[2.6em] text-xs leading-relaxed text-muted">
        {p?.description || "暂无描述"}
      </div>
      <div className="text-xs text-faint">
        对话 {counts.conversations ?? 0} · 图片 {counts.images ?? 0}
      </div>
      <div className="thumb-strip min-h-[52px]">
        {recentImages.map((img) => (
          <img
            key={img.id}
            src={imageThumbUrl(img)}
            alt={img.id}
            loading="lazy"
            onClick={(e) => {
              e.stopPropagation();
              onOpenImage(img.id);
            }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).remove();
            }}
          />
        ))}
      </div>
    </div>
  );
}

function HomeLightbox({ imageId, onClose }: { imageId: string; onClose: () => void }) {
  const router = useRouter();
  return (
    <Lightbox
      imageId={imageId}
      onClose={onClose}
      onGoConversation={(pid, cid) => router.push(`/projects/${pid}/conversation/${cid}`)}
    />
  );
}

// ---------------------------------------------------------------------------
// 新建项目弹窗（复用侧栏逻辑，但这里放一份独立实现避免循环依赖）
// ---------------------------------------------------------------------------

function openCreateProject(modal: ReturnType<typeof useModal>, router: ReturnType<typeof useRouter>) {
  return () =>
    modal.openModal({
      title: "新建项目",
      body: <CreateProjectForm />,
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
              if (res.project) router.push(`/projects/${res.project.id}`);
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

function CreateProjectForm() {
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
