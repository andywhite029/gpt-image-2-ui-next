"use client";

// 项目级未分类视图：左列对话 + 右列图片

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useConversations } from "@/hooks/use-conversation";
import { useImages } from "@/hooks/use-images";
import { useUI } from "@/app/providers";
import { ViewHeader, Loading, ErrorBox, Empty } from "@/components/ui/empty";
import { ImageGrid } from "@/components/gallery/image-grid";
import { Lightbox } from "@/components/gallery/lightbox";
import { fmtFullTime } from "@/lib/format";

export default function ProjectUncategorizedPage({
  params,
}: {
  params: Promise<{ pid: string }>;
}) {
  const { pid } = use(params);
  const router = useRouter();
  const { generatingConversationIds } = useUI();
  const { data: allConvs = [], isLoading: convsLoading } = useConversations(pid);
  const { data: imagesData, isLoading: imagesLoading, error } = useImages(pid, {
    uncategorized: true,
    limit: 200,
  });
  const [lightboxId, setLightboxId] = useState<string | null>(null);

  const convs = allConvs.filter((c) => !c.categoryId);
  const images = imagesData?.items ?? [];

  if (convsLoading || imagesLoading) return <Loading text="加载未分类…" />;
  if (error) return <ErrorBox message={"加载失败：" + (error as Error).message} />;

  return (
    <div>
      <ViewHeader title="🗂 未分类" desc="该项目下未归入任何分类的对话与图片。" />

      {!convs.length && !images.length ? (
        <Empty text="没有未分类的内容" />
      ) : (
        <div className="grid grid-cols-1 gap-4.5 md:grid-cols-[300px_1fr]">
          <div>
            <div className="section-title">对话（{convs.length}）</div>
            {!convs.length ? (
              <Empty text="没有未分类的对话" />
            ) : (
              <div className="row-list">
                {convs.map((c) => (
                  <div
                    key={c.id}
                    className="row-item"
                    onClick={() => router.push(`/projects/${pid}/conversation/${c.id}`)}
                  >
                    <div className="ri-main">
                      <div className="ri-title">💬 {c.title || c.id}</div>
                      <div className="ri-sub">更新于 {fmtFullTime(c.updatedAt)}</div>
                    </div>
                    {generatingConversationIds.has(c.id) && <span className="gen-dot" />}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <div className="section-title">图片（{imagesData?.total ?? images.length}）</div>
            <ImageGrid images={images} onImageClick={(img) => setLightboxId(img.id)} emptyText="没有未分类的图片" />
          </div>
        </div>
      )}

      {lightboxId && (
        <Lightbox
          imageId={lightboxId}
          siblingIds={images.map((i) => i.id)}
          onClose={() => setLightboxId(null)}
          onOpenImage={setLightboxId}
          onGoConversation={(p, c) => router.push(`/projects/${p}/conversation/${c}`)}
        />
      )}
    </div>
  );
}
