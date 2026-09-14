import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { ok, validationError, notFound } from "@/lib/errors";
import { errorResponse, readJsonBody, locateCategory } from "@/lib/api-helpers";
import { ensureInit } from "@/lib/init";
import { nowMs } from "@/lib/id";
import { categoryFromDb } from "@/lib/serialize";

/** PATCH /api/categories/[cid] — 改 name / sort_order */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ cid: string }> }
) {
  try {
    await ensureInit();
    const { cid } = await params;
    const cat = await locateCategory(cid);
    const data = await readJsonBody(request);

    const updates: Partial<typeof schema.categories.$inferInsert> = {};
    if ("name" in data) {
      if (typeof data.name !== "string" || !(data.name as string).trim()) {
        throw validationError("分类名称不能为空");
      }
      updates.name = (data.name as string).trim();
    }
    if ("sort_order" in data) {
      if (typeof data.sort_order !== "number" || !Number.isInteger(data.sort_order)) {
        throw validationError("sort_order 必须为整数");
      }
      updates.sortOrder = data.sort_order as number;
    }
    updates.updatedAt = nowMs();

    await db
      .update(schema.categories)
      .set(updates)
      .where(eq(schema.categories.id, cat.id));
    const rows = await db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.id, cat.id))
      .limit(1);
    return ok({ category: categoryFromDb(rows[0]!) });
  } catch (e) {
    return errorResponse(e);
  }
}

/** DELETE /api/categories/[cid] — 硬删除；子实体 categoryId 置 null（FK onDelete: set null） */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ cid: string }> }
) {
  try {
    await ensureInit();
    const { cid } = await params;
    const cat = await locateCategory(cid);
    if (!cat) throw notFound("分类不存在");

    // 显式把子实体 categoryId 置 null（conversations 有 FK set null，
    // 但 image_assets / requests / batches 的 categoryId 无 FK，需手动清理）
    await db.transaction(async (tx) => {
      await tx
        .update(schema.conversations)
        .set({ categoryId: null, updatedAt: nowMs() })
        .where(eq(schema.conversations.categoryId, cat.id));
      await tx
        .update(schema.imageAssets)
        .set({ categoryId: null, updatedAt: nowMs() })
        .where(eq(schema.imageAssets.categoryId, cat.id));
      await tx
        .update(schema.requests)
        .set({ categoryId: null })
        .where(eq(schema.requests.categoryId, cat.id));
      await tx
        .update(schema.batches)
        .set({ categoryId: null })
        .where(eq(schema.batches.categoryId, cat.id));
      await tx.delete(schema.categories).where(eq(schema.categories.id, cat.id));
    });

    return ok({ deleted: true, categoryId: cat.id });
  } catch (e) {
    return errorResponse(e);
  }
}
