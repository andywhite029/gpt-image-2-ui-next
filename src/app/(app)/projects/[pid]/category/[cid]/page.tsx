"use client";

// 分类视图：左列对话列表 + 右列图片网格

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { endpoints, errorText } from "@/lib/api-client";
import { useCategories, useConversations } from "@/hooks/use-conversation";
import { useImages } from "@/hooks/use-images";
import { useUI } from "@/app/providers";
import { useModal } from "@/components/ui/modal";
import { ViewHeader, Loading, ErrorBox, Empty } from "@/components/ui/empty";
import { ImageGrid } from "@/components/gallery/image-grid";
import { Lightbox } from "@/components/gallery/lightbox";
import { fmtFullTime } from "@/lib/format";
import { useQueryClient } from "@tanstack/react-query";

export default function CategoryPage({
  params,
}: {
  params: Promise<{ pid: string; cid: string }>;
}) {
  const { pid, cid } = use(params);
  const router = useRouter();
  const modal = useModal();
  const qc = useQueryClient();
  const { generatingConversationIds } = useUI();
  const { data: categories = [], isLoading: catsLoading } = useCategories(pid);
  const { data: conversations = [], isLoading: convsLoading } = useConversations(pid, cid);
  const { data: imagesData, isLoading: imagesLoading } = useImages(pid, { category_id: cid, limit: 200 });
  const [lightboxId, setLightboxId] = useState<string | null>(null);

  const cat = categories.find((c) => c.id === cid);
  const images = imagesData?.items ?? [];

  const isLoading = catsLoading || convsLoading || imagesLoading;
  if (isLoading) return <Loading text="加载分类…" />;

  const openCreateConversation = () => {
    modal.openModal({
      title: "新建对话",
      body: (
        <form id="create-conversation-form">
          <div className="field">
            <label className="field-label">标题（可选，留空自动生成）</label>
            <input type="text" name="title" className="input-text" placeholder="新对话" autoFocus />
          </div>
          <input type="hidden" name="category_id" value={cid} />
        </form>
      ),
      actions: [
        { label: "取消", kind: "ghost" },
        {
          label: "创建",
          kind: "primary",
          onClick: async () => {
            const form = document.getElementById("create-conversation-form") as HTMLFormElement | null;
            if (!form) return false;
            const fd = new FormData(form);
            try {
              const res = await endpoints.createConversation(pid, {
                title: String(fd.get("title") ?? "").trim() || undefined,
                category_id: cid,
              });
              toast.success("对话已创建");
              qc.invalidateQueries({ queryKey: ["conversations"] });
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

  const onDeleteCategory = async () => {
    const ok = await modal.confirmModal({
      title: "删除分类",
      message: "删除后，该分类下的对话和图片将转为「未分类」，记录和文件保留，且不会进入回收站。确定删除吗？",
      danger: true,
      confirmText: "删除分类",
    });
    if (!ok) return;
    try {
      const res = await endpoints.deleteCategory(pid, cid);
      toast.success(
        `分类已删除，${res.moved_conversations ?? 0} 个对话、${res.moved_images ?? 0} 张图片已转为未分类`
      );
      qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      router.push(`/projects/${pid}`);
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  return (
    <div>
      <ViewHeader
        title={cat ? `📁 ${cat.name}` : "分类"}
        actions={
          <>
            <button type="button" className="btn-ghost btn-ghost-sm" onClick={openCreateConversation}>
              ＋ 对话
            </button>
            <button type="button" className="btn-danger px-3 py-1.5 text-xs" onClick={onDeleteCategory}>
              删除分类
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4.5 md:grid-cols-[300px_1fr]">
        {/* 左：对话列表 */}
        <div>
          <div className="section-title">对话（{conversations.length}）</div>
          {!conversations.length ? (
            <Empty text="该分类下还没有对话" />
          ) : (
            <div className="row-list">
              {conversations.map((c) => (
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

        {/* 右：图片画廊 */}
        <div>
          <div className="section-title">图片（{imagesData?.total ?? images.length}）</div>
          <ImageGrid images={images} onImageClick={(img) => setLightboxId(img.id)} emptyText="该分类下还没有图片" />
        </div>
      </div>

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
