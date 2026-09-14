import { NextRequest } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { ok, validationError, notFound } from "@/lib/errors";
import { errorResponse, readJsonBody, locateConversation } from "@/lib/api-helpers";
import { ensureInit } from "@/lib/init";
import { CATEGORY_PREFIX, TRASH_PREFIX, newId, nowMs, validEntityId } from "@/lib/id";
import { imageSummary } from "@/lib/generation";
import {
  batchFromDb,
  conversationFromDb,
  imageAssetFromDb,
  requestFromDb,
  trashRecordToDb,
} from "@/lib/serialize";
import type { ConversationRound } from "@/types/entities";

/** GET /api/conversations/[cid] — detail + rounds（每个 request 附 batch + images） */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ cid: string }> }
) {
  try {
    await ensureInit();
    const { cid } = await params;
    const convRow = await locateConversation(cid);
    if (convRow.isDeleted) throw notFound("对话不存在或已删除");
    const conversation = convRow;

    // 按 conversationId 查 requests，createdAt 升序
    const reqRows = await db
      .select()
      .from(schema.requests)
      .where(eq(schema.requests.conversationId, cid))
      .orderBy(asc(schema.requests.createdAt));
    const requests = reqRows.map(requestFromDb).filter((r) => !r.isDeleted);

    const batchRows = await db.select().from(schema.batches);
    const imgRows = await db.select().from(schema.imageAssets);

    const rounds: ConversationRound[] = [];
    for (const request of requests) {
      const batchRow = batchRows.find((b) => b.id === request.batchId);
      const batch = batchRow ? batchFromDb(batchRow) : null;
      const images = [];
      if (batch) {
        for (const iid of batch.imageAssetIds) {
          const row = imgRows.find((r) => r.id === iid);
          if (row) {
            const asset = imageAssetFromDb(row);
            if (!asset.isDeleted) images.push(imageSummary(asset));
          }
        }
      }
      rounds.push({ request, batch, images });
    }

    return ok({ conversation, rounds });
  } catch (e) {
    return errorResponse(e);
  }
}

/** PATCH /api/conversations/[cid] — 改 title（置 titleCustom）/ category_id */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ cid: string }> }
) {
  try {
    await ensureInit();
    const { cid } = await params;
    const conv = await locateConversation(cid);
    if (conv.isDeleted) throw notFound("对话不存在或已删除");
    const data = await readJsonBody(request);

    const updates: Partial<typeof schema.conversations.$inferInsert> = {};
    if ("title" in data) {
      const title = data.title;
      if (typeof title !== "string" || !(title as string).trim()) {
        throw validationError("对话标题不能为空");
      }
      updates.title = (title as string).trim();
      updates.titleCustom = true;
    }
    if ("category_id" in data) {
      const categoryId = data.category_id;
      if (categoryId != null) {
        if (!validEntityId(categoryId as string, CATEGORY_PREFIX)) {
          throw validationError("分类不存在或不属于当前项目");
        }
        const catRows = await db
          .select({ id: schema.categories.id })
          .from(schema.categories)
          .where(eq(schema.categories.projectId, conv.projectId));
        if (!catRows.some((c) => c.id === categoryId)) {
          throw validationError("分类不存在或不属于当前项目");
        }
      }
      updates.categoryId = (categoryId as string | null) ?? null;
    }
    updates.updatedAt = nowMs();

    await db
      .update(schema.conversations)
      .set(updates)
      .where(eq(schema.conversations.id, cid));
    const rows = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, cid))
      .limit(1);
    return ok({ conversation: conversationFromDb(rows[0]!) });
  } catch (e) {
    return errorResponse(e);
  }
}

/** DELETE /api/conversations/[cid] — 软删除 + 级联软删 requests/batches/images + trash_record */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ cid: string }> }
) {
  try {
    await ensureInit();
    const { cid } = await params;
    const conv = await locateConversation(cid);
    if (conv.isDeleted) throw notFound("对话不存在或已删除");

    const now = nowMs();
    const record = await db.transaction(async (tx) => {
      const cascadeIds = { requests: [] as string[], batches: [] as string[], images: [] as string[] };

      // 级联软删 requests
      const reqRows = await tx
        .select()
        .from(schema.requests)
        .where(eq(schema.requests.conversationId, cid));
      for (const r of reqRows) {
        if (r.isDeleted) continue;
        await tx
          .update(schema.requests)
          .set({ isDeleted: true, deletedAt: now })
          .where(eq(schema.requests.id, r.id));
        cascadeIds.requests.push(r.id);
      }
      // 级联软删 batches（batches 表无 isDeleted 列：软删由级联的 request.isDeleted
      // 驱动可见性；cascadeIds.batches 仍记录 id 供回收站恢复/彻底删除用）
      const batchRows = await tx
        .select({ id: schema.batches.id })
        .from(schema.batches)
        .where(eq(schema.batches.conversationId, cid));
      for (const b of batchRows) {
        cascadeIds.batches.push(b.id);
      }
      // 级联软删 images
      const imgRows = await tx
        .select()
        .from(schema.imageAssets)
        .where(eq(schema.imageAssets.conversationId, cid));
      for (const img of imgRows) {
        if (img.isDeleted) continue;
        await tx
          .update(schema.imageAssets)
          .set({ isDeleted: true, deletedAt: now, updatedAt: now })
          .where(eq(schema.imageAssets.id, img.id));
        cascadeIds.images.push(img.id);
      }

      // 分类名
      let categoryName = "";
      if (conv.categoryId) {
        const catRows = await tx
          .select({ name: schema.categories.name })
          .from(schema.categories)
          .where(eq(schema.categories.id, conv.categoryId))
          .limit(1);
        categoryName = catRows[0]?.name ?? "";
      }

      await tx
        .update(schema.conversations)
        .set({ isDeleted: true, deletedAt: now, updatedAt: now })
        .where(eq(schema.conversations.id, cid));

      const record = {
        id: newId(TRASH_PREFIX),
        entityType: "conversation" as const,
        entityId: cid,
        projectId: conv.projectId,
        deletedAt: now,
        originalLocation: { category_id: conv.categoryId, category_name: categoryName },
        cascadeIds,
      };
      await tx.insert(schema.trashRecords).values(trashRecordToDb(record));
      return record;
    });

    return ok(record);
  } catch (e) {
    return errorResponse(e);
  }
}
