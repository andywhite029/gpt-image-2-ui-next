"use client";

// 模板管理：列表 + 新建/编辑弹窗 + 应用/删除
// 「应用到输入区」→ sessionStorage 暂存，跳到最近对话；对话页 input-area 挂载时消费

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  useTemplates,
  useCreateTemplate,
  usePatchTemplate,
  useDeleteTemplate,
} from "@/hooks/use-search-templates";
import { useProjects } from "@/hooks/use-projects";
import { useConversations } from "@/hooks/use-conversation";
import { useModal } from "@/components/ui/modal";
import { ViewHeader, Loading, ErrorBox, Empty } from "@/components/ui/empty";
import { errorText } from "@/lib/api-client";
import { truncate } from "@/lib/format";
import type { Template } from "@/types/entities";

export default function TemplatesPage() {
  const modal = useModal();
  const router = useRouter();
  const { data: templates = [], isLoading, error } = useTemplates();
  const createT = useCreateTemplate();
  const patchT = usePatchTemplate();
  const deleteT = useDeleteTemplate();

  // 「应用」需要一个目标对话：取第一个项目的第一个对话
  const { data: projects = [] } = useProjects(false);
  const firstProject = projects.find((p) => !p.archived && !p.hidden) ?? projects[0];
  const { data: conversations = [] } = useConversations(firstProject?.id ?? "", undefined);

  if (isLoading) return <Loading text="加载模板…" />;
  if (error) return <ErrorBox message={"加载失败：" + errorText(error)} />;

  const openEdit = (template: Template | null) => {
    modal.openModal({
      title: template ? "编辑模板" : "新建模板",
      body: <TemplateForm template={template} />,
      actions: [
        { label: "取消", kind: "ghost" },
        {
          label: "保存",
          kind: "primary",
          onClick: async () => {
            const form = document.getElementById("template-form") as HTMLFormElement | null;
            if (!form) return false;
            const fd = new FormData(form);
            const name = String(fd.get("name") ?? "").trim();
            const prompt = String(fd.get("prompt") ?? "").trim();
            if (!name || !prompt) {
              toast.error("名称和提示词都不能为空");
              return false;
            }
            const payload = {
              name,
              prompt,
              negative_prompt: String(fd.get("negative_prompt") ?? "").trim(),
              size: String(fd.get("size") ?? "").trim() || undefined,
              n: Number(fd.get("n")) || undefined,
            };
            try {
              if (template) await patchT.mutateAsync({ tid: template.id, ...payload });
              else await createT.mutateAsync(payload);
              toast.success("模板已保存");
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

  const onApply = (t: Template) => {
    if (!firstProject || !conversations.length) {
      toast.error("还没有可用的对话，先在项目中创建对话");
      return;
    }
    // 暂存待应用模板，对话页挂载 input-area 时消费
    sessionStorage.setItem("gpt_image2_prefill", JSON.stringify(t));
    toast.success(`模板「${t.name}」已应用到输入区`);
    router.push(`/projects/${firstProject.id}/conversation/${conversations[0]!.id}`);
  };

  const onDelete = async (t: Template) => {
    const ok = await modal.confirmModal({
      title: "删除模板",
      message: `确定删除模板「${t.name}」吗？`,
      danger: true,
      confirmText: "删除",
    });
    if (!ok) return;
    try {
      await deleteT.mutateAsync(t.id);
      toast.success("模板已删除");
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  return (
    <div>
      <ViewHeader
        title="📋 Prompt 模板"
        desc="全局模板可应用到任意对话的输入区。"
        actions={
          <button type="button" className="btn-ghost btn-ghost-sm" onClick={() => openEdit(null)}>
            ＋ 新建模板
          </button>
        }
      />

      {!templates.length ? (
        <Empty text="还没有模板" />
      ) : (
        <div className="row-list">
          {templates.map((t) => (
            <div key={t.id} className="row-item">
              <div className="ri-main">
                <div className="ri-title">{t.name}</div>
                <div className="ri-sub">
                  {truncate(t.prompt, 120)}
                  {t.negativePrompt ? " · 负面: " + truncate(t.negativePrompt, 80) : ""}
                </div>
              </div>
              <div className="ri-side">
                <button type="button" className="btn-ghost btn-ghost-sm" onClick={() => onApply(t)}>
                  应用到输入区
                </button>
                <button type="button" className="btn-ghost btn-ghost-sm" onClick={() => openEdit(t)}>
                  编辑
                </button>
                <button
                  type="button"
                  className="btn-danger px-3 py-1.5 text-xs"
                  disabled={deleteT.isPending}
                  onClick={() => onDelete(t)}
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateForm({ template }: { template: Template | null }) {
  return (
    <form id="template-form">
      <div className="field">
        <label className="field-label">模板名称</label>
        <input type="text" name="name" className="input-text" defaultValue={template?.name ?? ""} autoFocus />
      </div>
      <div className="field">
        <label className="field-label">提示词内容</label>
        <textarea name="prompt" className="input-text" rows={6} defaultValue={template?.prompt ?? ""} />
      </div>
      <div className="field">
        <label className="field-label">负面 Prompt</label>
        <textarea name="negative_prompt" className="input-text" rows={3} defaultValue={template?.negativePrompt ?? ""} />
      </div>
      <div className="grid grid-cols-2 gap-3 max-[560px]:grid-cols-1">
        <div className="field">
          <label className="field-label">默认尺寸</label>
          <input
            type="text"
            name="size"
            className="input-text"
            placeholder="1024x1024"
            defaultValue={template?.size ?? ""}
          />
        </div>
        <div className="field">
          <label className="field-label">默认数量</label>
          <select name="n" className="input-select" defaultValue={String(template?.n ?? "")}>
            <option value="">留空</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="4">4</option>
          </select>
        </div>
      </div>
    </form>
  );
}
