import { NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { ok, ServiceError, validationError } from "@/lib/errors";
import { errorResponse, readJsonBody, requireProject } from "@/lib/api-helpers";
import { ensureInit } from "@/lib/init";
import { CATEGORY_PREFIX, CONVERSATION_PREFIX, newId, nowMs, validEntityId } from "@/lib/id";
import { conversationFromDb } from "@/lib/serialize";

/** GET /api/projects/[pid]/conversations — query: category_id 过滤；updatedAt 倒序 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pid: string }> }
) {
  try {
    await ensureInit();
    const { pid } = await params;
    await requireProject(pid);

    // category_id 过滤：URL 无参数 → 返回全部；category_id= 空 → 仅未分类。
    // 注意 searchParams.get 无参数时返回 null，需与 undefined（未过滤）区分。
    const rawCategoryId = request.nextUrl.searchParams.get("category_id");
    let categoryId: string | null | undefined =
      rawCategoryId == null ? undefined : rawCategoryId.trim() || null;
    if (categoryId != null && !validEntityId(categoryId, CATEGORY_PREFIX)) {
      throw new ServiceError("非法的分类 ID", "INVALID_REQUEST", 400, categoryId);
    }

    const rows = await db
      .select()
      .from(schema.conversations)
      .where(
        sql`${schema.conversations.projectId} = ${pid} AND ${schema.conversations.isDeleted} = 0`
      )
      .orderBy(
        sql`${schema.conversations.updatedAt} DESC, ${schema.conversations.createdAt} DESC`
      );

    let conversations = rows.map(conversationFromDb);
    if (categoryId !== undefined) {
      conversations = conversations.filter((c) => c.categoryId === categoryId);
    }
    return ok({ conversations });
  } catch (e) {
    return errorResponse(e);
  }
}

/** POST /api/projects/[pid]/conversations — 创建（category_id 校验归属） */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ pid: string }> }
) {
  try {
    await ensureInit();
    const { pid } = await params;
    await requireProject(pid);
    const data = await readJsonBody(request);

    let categoryId: string | null = null;
    if (data.category_id != null) {
      categoryId = data.category_id as string;
      if (!validEntityId(categoryId, CATEGORY_PREFIX)) {
        throw new ServiceError("非法的分类 ID", "INVALID_REQUEST", 400, categoryId);
      }
      const catRows = await db
        .select({ id: schema.categories.id })
        .from(schema.categories)
        .where(eq(schema.categories.projectId, pid));
      if (!catRows.some((c) => c.id === categoryId)) {
        throw validationError("分类不存在或不属于当前项目");
      }
    }

    const title =
      typeof data.title === "string" && data.title.trim() ? data.title.trim() : "新对话";
    if (!title) throw validationError("对话标题不能为空");

    const ts = nowMs();
    const conversation = {
      id: newId(CONVERSATION_PREFIX),
      projectId: pid,
      categoryId,
      title,
      isInitial: false,
      titleCustom: false,
      createdAt: ts,
      updatedAt: ts,
      isDeleted: false,
      deletedAt: null,
    };
    await db.insert(schema.conversations).values(conversation);
    return ok({ conversation }, 201);
  } catch (e) {
    return errorResponse(e);
  }
}
