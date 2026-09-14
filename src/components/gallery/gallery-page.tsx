"use client";

// 跨项目图片画廊页（全部图片 / 收藏 / 未分类 共用）

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useProjects } from "@/hooks/use-projects";
import { useImages, type ImageFilters } from "@/hooks/use-images";
import { ViewHeader, Loading, Empty } from "@/components/ui/empty";
import { ImageGrid } from "@/components/gallery/image-grid";
import { Lightbox } from "@/components/gallery/lightbox";
import type { ImageSummary } from "@/types/entities";

const PAGE_SIZE = 60;
const FETCH_LIMIT = 200;

export function GalleryPage({
  title,
  filters,
  emptyText,
}: {
  title: React.ReactNode;
  filters: Omit<ImageFilters, "limit" | "offset">;
  emptyText: string;
}) {
  const { data: projects = [], isLoading: projectsLoading } = useProjects(true);
  const projectIds = useMemo(() => projects.map((p) => p.id), [projects]);

  return (
    <div>
      <ViewHeader title={title} />
      {projectsLoading ? (
        <Loading text="加载图片…" />
      ) : !projectIds.length ? (
        <Empty text="还没有项目，先创建一个项目并生成图片吧" />
      ) : (
        <GalleryBody projectIds={projectIds} filters={filters} emptyText={emptyText} />
      )}
    </div>
  );
}

/** 单项目图片加载（子组件中调用 hook，数量由 projects 决定） */
function ProjectImages({
  pid,
  filters,
  sort,
  onLoaded,
}: {
  pid: string;
  filters: Omit<ImageFilters, "limit" | "offset">;
  sort: string;
  onLoaded: (pid: string, items: ImageSummary[]) => void;
}) {
  const { data } = useImages(pid, { ...filters, limit: FETCH_LIMIT, sort });
  useEffect(() => {
    onLoaded(pid, data?.items ?? []);
  }, [pid, data, onLoaded]);
  return null;
}

function GalleryBody({
  projectIds,
  filters,
  emptyText,
}: {
  projectIds: string[];
  filters: Omit<ImageFilters, "limit" | "offset">;
  emptyText: string;
}) {
  const router = useRouter();
  const [sort, setSort] = useState<"desc" | "asc">("desc");
  const [shown, setShown] = useState(PAGE_SIZE);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [lightboxSiblings, setLightboxSiblings] = useState<string[]>([]);
  // pid → items（子组件回传）
  const [itemsByProject, setItemsByProject] = useState<Record<string, ImageSummary[]>>({});

  const onLoaded = useMemo(
    () =>
      (pid: string, items: ImageSummary[]) => {
        setItemsByProject((prev) =>
          prev[pid] === items || (prev[pid]?.length === 0 && items.length === 0)
            ? prev[pid] === items ? prev : { ...prev, [pid]: items }
            : { ...prev, [pid]: items }
        );
      },
    []
  );

  const allImages = useMemo(() => {
    const all = projectIds.flatMap((pid) => itemsByProject[pid] ?? []);
    const dir = sort === "asc" ? 1 : -1;
    all.sort((a, b) => dir * ((a.createdAt || 0) - (b.createdAt || 0)));
    return all;
  }, [itemsByProject, projectIds, sort]);

  useEffect(() => {
    setShown(PAGE_SIZE);
  }, [sort]);

  const visible = allImages.slice(0, shown);

  return (
    <>
      {/* 每项目一个查询子组件 */}
      {projectIds.map((pid) => (
        <ProjectImages key={pid + sort} pid={pid} filters={filters} sort={sort} onLoaded={onLoaded} />
      ))}

      <div className="filter-bar">
        <select
          className="input-select w-auto"
          value={sort}
          onChange={(e) => setSort(e.target.value as "desc" | "asc")}
        >
          <option value="desc">时间倒序</option>
          <option value="asc">时间正序</option>
        </select>
        <span className="text-xs text-muted">共 {allImages.length} 张</span>
      </div>

      {!allImages.length ? (
        <Empty text={emptyText} />
      ) : (
        <>
          <ImageGrid
            images={visible}
            onImageClick={(img) => {
              setLightboxSiblings(allImages.map((i) => i.id));
              setLightboxId(img.id);
            }}
          />
          {shown < allImages.length && (
            <div className="mt-3.5 flex justify-center">
              <button
                type="button"
                className="btn-ghost btn-ghost-sm"
                onClick={() => setShown((v) => v + PAGE_SIZE)}
              >
                加载更多
              </button>
            </div>
          )}
        </>
      )}

      {lightboxId && (
        <Lightbox
          imageId={lightboxId}
          siblingIds={lightboxSiblings}
          onClose={() => setLightboxId(null)}
          onOpenImage={setLightboxId}
          onGoConversation={(p, c) => router.push(`/projects/${p}/conversation/${c}`)}
        />
      )}
    </>
  );
}
