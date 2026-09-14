import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { ok, ServiceError } from "@/lib/errors";
import { errorResponse, truthy } from "@/lib/api-helpers";
import { ensureInit } from "@/lib/init";
import { validEntityId } from "@/lib/id";
import type { SearchResult } from "@/types/entities";

const EXCERPT_LEN = 40;
const RESULT_LIMIT = 200;

const REFERENCE_TYPE_LABELS: Record<string, string> = {
  uploaded: "上传",
  from_generation: "历史图片",
};

function excerpt(text: string, length = EXCERPT_LEN): string {
  const t = (text || "").trim();
  return t.length <= length ? t : t.slice(0, length) + "…";
}

/** q 大小写不敏感子串匹配（SQLite LIKE 默认 ASCII 大小写不敏感；中文直接子串）。 */
function likePattern(q: string): string {
  return `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
}

interface SearchQueryParams {
  q: string;
  projectId: string | null;
  categoryId: string | null;
  favoritesOnly: boolean;
  referenceLibraryOnly: boolean;
  uncategorizedOnly: boolean;
  sort: "asc" | "desc";
}

function categoryFilterOk(item: SearchResult, categoryId: string | null): boolean {
  if (categoryId == null) return true;
  if (item.type === "category") return item.id === categoryId;
  if (item.type === "conversation" || item.type === "request" || item.type === "image") {
    return item.categoryId === categoryId;
  }
  return false;
}

/** GET /api/search — 全库搜索（SQL LIKE 跨表；结果 LIMIT 200，排除 isDeleted） */
export async function GET(request: NextRequest) {
  try {
    await ensureInit();
    const sp = request.nextUrl.searchParams;
    const params: SearchQueryParams = {
      q: (sp.get("q") || "").trim().toLowerCase(),
      projectId: sp.get("project_id") || null,
      categoryId: sp.get("category_id") || null,
      favoritesOnly: truthy(sp.get("favorites")),
      referenceLibraryOnly: truthy(sp.get("reference_library")),
      uncategorizedOnly: truthy(sp.get("uncategorized")),
      sort: sp.get("sort") === "asc" ? "asc" : "desc",
    };

    if (params.projectId && !validEntityId(params.projectId, "proj_")) {
      throw new ServiceError("非法的项目 ID", "INVALID_REQUEST", 400, params.projectId);
    }
    if (params.categoryId && !validEntityId(params.categoryId, "cat_")) {
      throw new ServiceError("非法的分类 ID", "INVALID_REQUEST", 400, params.categoryId);
    }

    // 类型裁剪：各筛选对可命中类型的交集
    let types = new Set(["project", "category", "conversation", "request", "image", "reference"]);
    if (params.referenceLibraryOnly) types = new Set(["reference"]);
    if (params.favoritesOnly) types = new Set([...types].filter((t) => t === "image" || t === "reference"));
    if (params.uncategorizedOnly) types = new Set([...types].filter((t) => t === "image" || t === "conversation"));

    const like = params.q ? likePattern(params.q) : null;
    const items: SearchResult[] = [];

    const projects = (await db.select().from(schema.projects))
      .filter((p) => (params.projectId ? p.id === params.projectId : true));
    const projectNames = new Map(projects.map((p) => [p.id, p.name]));

    // 分类名映射（受 project_id 筛选约束）
    const catRows = params.projectId
      ? await db.select().from(schema.categories).where(sql`${schema.categories.projectId} = ${params.projectId}`)
      : await db.select().from(schema.categories);
    const catNames = new Map(catRows.map((c) => [c.id, c.name]));

    // ---- projects ----
    if (types.has("project")) {
      for (const p of projects) {
        if (
          like &&
          !`${p.name}\n${p.description}`.toLowerCase().includes(params.q) &&
          !(p.name.toLowerCase().includes(params.q) || (p.description || "").toLowerCase().includes(params.q))
        ) {
          continue;
        }
        const desc = (p.description || "").trim();
        const typeLabel = p.type === "video_project" ? "视频工程" : "自由创作";
        const item: SearchResult = {
          type: "project",
          id: p.id,
          title: p.name || "",
          subtitle: desc ? excerpt(desc) : typeLabel,
          projectId: p.id,
          projectName: p.name || "",
          categoryId: null,
          categoryName: null,
          conversationId: null,
          timestamp: p.createdAt,
        };
        if (categoryFilterOk(item, params.categoryId)) items.push(item);
      }
    }

    // ---- categories ----
    if (types.has("category")) {
      for (const c of catRows) {
        if (like && !(c.name || "").toLowerCase().includes(params.q)) continue;
        const item: SearchResult = {
          type: "category",
          id: c.id,
          title: c.name || "",
          subtitle: "分类",
          projectId: c.projectId,
          projectName: projectNames.get(c.projectId) || "",
          categoryId: null,
          categoryName: null,
          conversationId: null,
          timestamp: c.createdAt,
        };
        if (categoryFilterOk(item, params.categoryId)) items.push(item);
      }
    }

    // ---- conversations ----
    if (types.has("conversation")) {
      const rows = params.projectId
        ? await db.select().from(schema.conversations).where(sql`${schema.conversations.projectId} = ${params.projectId} AND ${schema.conversations.isDeleted} = 0`)
        : await db.select().from(schema.conversations).where(sql`${schema.conversations.isDeleted} = 0`);
      for (const c of rows) {
        if (params.uncategorizedOnly && c.categoryId != null) continue;
        if (like && !(c.title || "").toLowerCase().includes(params.q)) continue;
        const item: SearchResult = {
          type: "conversation",
          id: c.id,
          title: c.title || "",
          subtitle: "对话",
          projectId: c.projectId,
          projectName: projectNames.get(c.projectId) || "",
          categoryId: c.categoryId,
          categoryName: c.categoryId ? catNames.get(c.categoryId) ?? null : null,
          conversationId: c.id,
          timestamp: c.createdAt,
        };
        if (categoryFilterOk(item, params.categoryId)) items.push(item);
      }
    }

    // ---- requests ----
    if (types.has("request")) {
      const rows = params.projectId
        ? await db.select().from(schema.requests).where(sql`${schema.requests.projectId} = ${params.projectId} AND ${schema.requests.isDeleted} = 0`)
        : await db.select().from(schema.requests).where(sql`${schema.requests.isDeleted} = 0`);
      for (const r of rows) {
        if (
          like &&
          !(r.promptOriginal || "").toLowerCase().includes(params.q) &&
          !(r.promptEffective || "").toLowerCase().includes(params.q)
        ) {
          continue;
        }
        const item: SearchResult = {
          type: "request",
          id: r.id,
          title: "生成请求",
          subtitle: excerpt(r.promptEffective || r.promptOriginal || ""),
          projectId: r.projectId,
          projectName: projectNames.get(r.projectId) || "",
          categoryId: r.categoryId,
          categoryName: r.categoryId ? catNames.get(r.categoryId) ?? null : null,
          conversationId: r.conversationId,
          timestamp: r.createdAt,
        };
        if (categoryFilterOk(item, params.categoryId)) items.push(item);
      }
    }

    // ---- images（user_note/tags 匹配；subtitle 用关联 request 的 prompt） ----
    if (types.has("image")) {
      const rows = params.projectId
        ? await db.select().from(schema.imageAssets).where(sql`${schema.imageAssets.projectId} = ${params.projectId} AND ${schema.imageAssets.isDeleted} = 0`)
        : await db.select().from(schema.imageAssets).where(sql`${schema.imageAssets.isDeleted} = 0`);
      for (const img of rows) {
        if (params.favoritesOnly && !img.isFavorited) continue;
        if (params.uncategorizedOnly && img.categoryId != null) continue;
        const note = img.userNote || "";
        let tags: string[] = [];
        try {
          const t = JSON.parse(img.tags || "[]");
          if (Array.isArray(t)) tags = t.filter((x) => typeof x === "string");
        } catch {
          // ignore
        }
        const noteHit = !like || note.toLowerCase().includes(params.q);
        const tagHit = !like || tags.some((t) => t.toLowerCase().includes(params.q));
        if (!noteHit && !tagHit) continue;

        // subtitle：关联 request 的 prompt
        let prompt = "";
        if (img.requestId) {
          const reqRows = await db
            .select()
            .from(schema.requests)
            .where(sql`${schema.requests.id} = ${img.requestId}`)
            .limit(1);
          if (reqRows[0]) {
            prompt = reqRows[0].promptEffective || reqRows[0].promptOriginal || "";
          }
        }
        const item: SearchResult = {
          type: "image",
          id: img.id,
          title: note || "图片",
          subtitle: excerpt(prompt),
          projectId: img.projectId,
          projectName: projectNames.get(img.projectId) || "",
          categoryId: img.categoryId,
          categoryName: img.categoryId ? catNames.get(img.categoryId) ?? null : null,
          conversationId: img.conversationId,
          timestamp: img.createdAt,
        };
        if (categoryFilterOk(item, params.categoryId)) items.push(item);
      }
    }

    // ---- references ----
    if (types.has("reference")) {
      const rows = params.projectId
        ? await db.select().from(schema.referenceAssets).where(sql`${schema.referenceAssets.projectId} = ${params.projectId} AND ${schema.referenceAssets.isDeleted} = 0`)
        : await db.select().from(schema.referenceAssets).where(sql`${schema.referenceAssets.isDeleted} = 0`);
      for (const ref of rows) {
        if (params.favoritesOnly && !ref.isFavorited) continue;
        const name = ref.name || "";
        const note = ref.userNote || "";
        let tags: string[] = [];
        try {
          const t = JSON.parse(ref.tags || "[]");
          if (Array.isArray(t)) tags = t.filter((x) => typeof x === "string");
        } catch {
          // ignore
        }
        const textHit =
          !like ||
          name.toLowerCase().includes(params.q) ||
          note.toLowerCase().includes(params.q);
        const tagHit = !like || tags.some((t) => t.toLowerCase().includes(params.q));
        if (!textHit && !tagHit) continue;

        const label = REFERENCE_TYPE_LABELS[ref.type] || "参考图";
        let filename = ref.originalFilename || "";
        if (!filename && ref.filePath) {
          filename = ref.filePath.replace(/\\/g, "/").split("/").pop() || "";
        }
        const subtitle = filename ? `${label} · ${filename}` : label;
        const item: SearchResult = {
          type: "reference",
          id: ref.id,
          title: name,
          subtitle,
          projectId: ref.projectId,
          projectName: projectNames.get(ref.projectId) || "",
          categoryId: null,
          categoryName: null,
          conversationId: null,
          timestamp: ref.createdAt,
        };
        if (categoryFilterOk(item, params.categoryId)) items.push(item);
      }
    }

    // 排序 + LIMIT 200
    items.sort((a, b) =>
      params.sort === "asc" ? a.timestamp - b.timestamp : b.timestamp - a.timestamp
    );
    const limited = items.slice(0, RESULT_LIMIT);
    return ok({ results: limited });
  } catch (e) {
    return errorResponse(e);
  }
}
