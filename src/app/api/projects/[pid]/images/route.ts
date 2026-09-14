import { NextRequest } from "next/server";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { badRequest, ok } from "@/lib/errors";
import {
  errorResponse,
  requireProject,
  requireValidId,
  truthy,
} from "@/lib/api-helpers";
import { ensureInit } from "@/lib/init";
import { CATEGORY_PREFIX } from "@/lib/id";
import { imageSummary } from "@/lib/generation";
import { imageAssetFromDb } from "@/lib/serialize";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

/**
 * GET /api/projects/[pid]/images — 项目图片列表（未删）。
 * query：category_id（cat_ 格式校验）/ favorites / uncategorized 筛选；
 * sort=asc|desc（按 createdAt，默认倒序）；limit（默认 200，上限 500）/ offset 分页。
 * 返回 { items, total }，total 为满足筛选的总数（不含分页）。
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pid: string }> }
) {
  try {
    await ensureInit();
    const { pid } = await params;
    await requireProject(pid);

    const sp = request.nextUrl.searchParams;

    // ---- 筛选 ----
    const categoryId = (sp.get("category_id") || "").trim() || null;
    if (categoryId) requireValidId(categoryId, CATEGORY_PREFIX, "分类");

    const where = and(
      eq(schema.imageAssets.projectId, pid),
      eq(schema.imageAssets.isDeleted, false),
      categoryId ? eq(schema.imageAssets.categoryId, categoryId) : undefined,
      truthy(sp.get("favorites"))
        ? eq(schema.imageAssets.isFavorited, true)
        : undefined,
      truthy(sp.get("uncategorized"))
        ? isNull(schema.imageAssets.categoryId)
        : undefined
    );

    // ---- 分页参数 ----
    let limit = DEFAULT_LIMIT;
    const limitParam = (sp.get("limit") || "").trim();
    if (limitParam) {
      const n = Number(limitParam);
      if (!Number.isInteger(n) || n < 1) throw badRequest("limit 必须是正整数");
      limit = Math.min(n, MAX_LIMIT);
    }
    let offset = 0;
    const offsetParam = (sp.get("offset") || "").trim();
    if (offsetParam) {
      const n = Number(offsetParam);
      if (!Number.isInteger(n) || n < 0) throw badRequest("offset 必须是非负整数");
      offset = n;
    }

    // ---- 总数（不含分页，前端展示「图片（N）」用） ----
    const [countRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.imageAssets)
      .where(where);
    const total = countRow?.count ?? 0;

    // ---- 列表（id 兜底排序，保证同 createdAt 下分页稳定） ----
    const ascending = sp.get("sort") === "asc";
    const rows = await db
      .select()
      .from(schema.imageAssets)
      .where(where)
      .orderBy(
        ascending
          ? asc(schema.imageAssets.createdAt)
          : desc(schema.imageAssets.createdAt),
        ascending ? asc(schema.imageAssets.id) : desc(schema.imageAssets.id)
      )
      .limit(limit)
      .offset(offset);

    return ok({
      items: rows.map((r) => imageSummary(imageAssetFromDb(r))),
      total,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
