"use client";

// 搜索内容（由 search/page.tsx 的 Suspense 包裹）

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSearch } from "@/hooks/use-search-templates";
import { useProjects } from "@/hooks/use-projects";
import { ViewHeader, Loading, Empty } from "@/components/ui/empty";
import { Lightbox } from "@/components/gallery/lightbox";
import { fmtFullTime } from "@/lib/format";
import type { SearchResult } from "@/types/entities";

const SEARCH_TYPE_LABEL: Record<string, string> = {
  project: "项目",
  category: "分类",
  conversation: "对话",
  request: "生成请求",
  image: "图片",
  reference: "参考图",
};

const TYPE_ORDER = ["project", "category", "conversation", "request", "image", "reference"];

export function SearchContent() {
  const searchParams = useSearchParams();
  const q = (searchParams.get("q") ?? "").trim();

  const router = useRouter();
  const { data: projects = [] } = useProjects(true);
  const [projectId, setProjectId] = useState("");
  const [favorites, setFavorites] = useState(false);
  const [referenceLibrary, setReferenceLibrary] = useState(false);
  const [uncategorized, setUncategorized] = useState(false);
  const [sort, setSort] = useState<"desc" | "asc">("desc");
  const [lightboxId, setLightboxId] = useState<string | null>(null);

  const { data: results = [], isLoading } = useSearch(
    {
      q: q || undefined,
      project_id: projectId || undefined,
      favorites: favorites || undefined,
      reference_library: referenceLibrary || undefined,
      uncategorized: uncategorized || undefined,
      sort,
    },
    true
  );

  const jump = (r: SearchResult) => {
    switch (r.type) {
      case "project":
        router.push(`/projects/${r.id}`);
        break;
      case "category":
        if (r.projectId) router.push(`/projects/${r.projectId}/category/${r.id}`);
        break;
      case "conversation":
        if (r.projectId) router.push(`/projects/${r.projectId}/conversation/${r.id}`);
        break;
      case "request":
        if (r.conversationId && r.projectId)
          router.push(`/projects/${r.projectId}/conversation/${r.conversationId}`);
        else if (r.projectId) router.push(`/projects/${r.projectId}`);
        break;
      case "image":
        setLightboxId(r.id);
        break;
      case "reference":
        if (r.projectId) router.push(`/reference-library?project=${r.projectId}`);
        break;
    }
  };

  const groups = new Map<string, SearchResult[]>();
  for (const r of results) {
    if (!groups.has(r.type)) groups.set(r.type, []);
    groups.get(r.type)!.push(r);
  }

  return (
    <div>
      <ViewHeader
        title={`搜索：${q || "（全部）"}`}
        desc="覆盖项目、分类、对话、Prompt、备注、标签和参考图名。"
      />

      <div className="filter-bar">
        <select className="input-select w-auto" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">全部项目</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={favorites} onChange={(e) => setFavorites(e.target.checked)} />
          只看收藏
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={referenceLibrary}
            onChange={(e) => setReferenceLibrary(e.target.checked)}
          />
          只看参考图库
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={uncategorized}
            onChange={(e) => setUncategorized(e.target.checked)}
          />
          只看未分类
        </label>
        <select
          className="input-select w-auto"
          value={sort}
          onChange={(e) => setSort(e.target.value as "desc" | "asc")}
        >
          <option value="desc">时间倒序</option>
          <option value="asc">时间正序</option>
        </select>
      </div>

      {isLoading ? (
        <Loading text="搜索中…" />
      ) : !results.length ? (
        <Empty text="没有匹配的结果" />
      ) : (
        TYPE_ORDER.filter((t) => groups.has(t)).map((type) => {
          const group = groups.get(type)!;
          return (
            <div key={type}>
              <div className="section-title">
                {SEARCH_TYPE_LABEL[type] ?? type}（{group.length}）
              </div>
              <div className="row-list">
                {group.map((r) => (
                  <div key={r.type + r.id} className="row-item" onClick={() => jump(r)}>
                    <div className="ri-main">
                      <div className="ri-title">
                        <span className="tag">{SEARCH_TYPE_LABEL[r.type] ?? r.type}</span> {r.title || r.id}
                      </div>
                      <div className="ri-sub">
                        {[
                          [r.projectName, r.categoryName].filter(Boolean).join(" / "),
                          r.subtitle,
                          r.timestamp ? fmtFullTime(r.timestamp) : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}

      {lightboxId && (
        <Lightbox
          imageId={lightboxId}
          onClose={() => setLightboxId(null)}
          onOpenImage={setLightboxId}
          onGoConversation={(p, c) => router.push(`/projects/${p}/conversation/${c}`)}
        />
      )}
    </div>
  );
}
