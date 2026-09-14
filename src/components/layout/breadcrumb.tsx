"use client";

// 面包屑：从 TanStack Query 缓存解析项目/分类/对话名称

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/hooks/use-projects";

const ROUTE_LABEL: Record<string, string> = {
  "all-images": "全部图片",
  favorites: "收藏",
  "reference-library": "参考图库",
  uncategorized: "未分类",
  trash: "回收站",
  templates: "模板",
  search: "搜索",
};

export function Breadcrumb() {
  const params = useParams<{ pid?: string; cid?: string }>();
  const qc = useQueryClient();
  const pathname = typeof window !== "undefined" ? window.location.pathname : "";

  // 从缓存取名称
  const projectName = (() => {
    if (!params.pid) return null;
    const overview = qc.getQueryData(queryKeys.projectOverview(params.pid)) as
      | { project?: { name?: string } }
      | undefined;
    if (overview?.project?.name) return overview.project.name;
    // 尝试项目列表缓存
    for (const includeHidden of [true, false]) {
      const list = qc.getQueryData<{ id: string; name: string }[]>(queryKeys.projects(includeHidden));
      const hit = list?.find((p) => p.id === params.pid);
      if (hit) return hit.name;
    }
    return params.pid.slice(0, 10) + "…";
  })();

  const categoryName = (() => {
    if (!params.pid || !params.cid) return null;
    const cats = qc.getQueryData(queryKeys.categories(params.pid)) as
      | Array<{ id: string; name: string }>
      | undefined;
    const hit = cats?.find((c) => c.id === params.cid);
    return hit ? hit.name : params.cid.slice(0, 10) + "…";
  })();

  const conversationName = (() => {
    if (!params.cid) return null;
    const data = qc.getQueryData(queryKeys.conversation(params.cid)) as
      | { conversation?: { title?: string } }
      | undefined;
    return data?.conversation?.title ?? params.cid.slice(0, 10) + "…";
  })();

  // 解析当前路径段
  const segments = pathname.split("/").filter(Boolean);
  const isConversation = segments.includes("conversation");
  const isCategory = segments.includes("category");
  const isUncategorized = segments.includes("uncategorized");

  return (
    <nav
      aria-label="面包屑"
      className="flex min-h-[42px] flex-wrap items-center gap-1.5 border-b border-border bg-panel px-5 py-2.5 text-[13px] text-muted"
    >
      <Link href="/" className="text-muted hover:text-text hover:no-underline">
        首页
      </Link>
      {projectName && (
        <>
          <span className="text-faint">/</span>
          {isConversation || isCategory || isUncategorized ? (
            <Link
              href={`/projects/${params.pid}`}
              className="text-muted hover:text-text hover:no-underline"
            >
              {projectName}
            </Link>
          ) : (
            <span className="font-semibold text-text">{projectName}</span>
          )}
        </>
      )}
      {isCategory && categoryName && (
        <>
          <span className="text-faint">/</span>
          <span className="font-semibold text-text">{categoryName}</span>
        </>
      )}
      {isConversation && conversationName && (
        <>
          <span className="text-faint">/</span>
          <span className="font-semibold text-text">{conversationName}</span>
        </>
      )}
      {isUncategorized && (
        <>
          <span className="text-faint">/</span>
          <span className="font-semibold text-text">未分类</span>
        </>
      )}
      {!projectName &&
        ROUTE_LABEL[segments[0] ?? ""] &&
        (() => {
          const label = ROUTE_LABEL[segments[0]!]!;
          return (
            <>
              <span className="text-faint">/</span>
              <span className="font-semibold text-text">{label}</span>
            </>
          );
        })()}
    </nav>
  );
}
