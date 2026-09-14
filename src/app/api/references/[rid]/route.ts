import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { ok, validationError, notFound } from "@/lib/errors";
import { errorResponse, readJsonBody, locateReference } from "@/lib/api-helpers";
import { ensureInit } from "@/lib/init";
import { TRASH_PREFIX, newId, nowMs } from "@/lib/id";
import { referenceView } from "@/lib/generation";
import { referenceAssetFromDb, trashRecordToDb } from "@/lib/serialize";

/** GET /api/references/[rid] — 参考图详情 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ rid: string }> }
) {
  try {
    await ensureInit();
    const { rid } = await params;
    const ref = await locateReference(rid);
    if (ref.isDeleted) throw notFound("参考图不存在或已被删除");
    return ok({ reference: referenceView(ref) });
  } catch (e) {
    return errorResponse(e);
  }
}

/** PATCH /api/references/[rid] — 改 name / user_note / tags / is_favorited */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ rid: string }> }
) {
  try {
    await ensureInit();
    const { rid } = await params;
    const ref = await locateReference(rid);
    if (ref.isDeleted) throw notFound("参考图不存在或已被删除");
    const data = await readJsonBody(request);

    const updates: Record<string, unknown> = { updatedAt: nowMs() };
    if ("name" in data) {
      if (typeof data.name !== "string" || !(data.name as string).trim()) {
        throw validationError("参考图名称不能为空");
      }
      updates.name = (data.name as string).trim();
    }
    if ("user_note" in data) {
      const note = data.user_note;
      updates.userNote = note == null ? "" : String(note);
    }
    if ("tags" in data) {
      const tags = data.tags;
      if (!Array.isArray(tags) || !(tags as unknown[]).every((t) => typeof t === "string")) {
        throw validationError("标签必须是字符串数组");
      }
      updates.tags = JSON.stringify(tags);
    }
    if ("is_favorited" in data) {
      updates.isFavorited = !!data.is_favorited;
    }

    await db
      .update(schema.referenceAssets)
      .set(updates as Partial<typeof schema.referenceAssets.$inferInsert>)
      .where(eq(schema.referenceAssets.id, rid));

    const rows = await db
      .select()
      .from(schema.referenceAssets)
      .where(eq(schema.referenceAssets.id, rid))
      .limit(1);
    return ok({ reference: referenceView(referenceAssetFromDb(rows[0]!)) });
  } catch (e) {
    return errorResponse(e);
  }
}

/** DELETE /api/references/[rid] — 软删除 + trash */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ rid: string }> }
) {
  try {
    await ensureInit();
    const { rid } = await params;
    const ref = await locateReference(rid);
    if (ref.isDeleted) throw notFound("参考图不存在或已被删除");

    const ts = nowMs();
    const record = await db.transaction(async (tx) => {
      await tx
        .update(schema.referenceAssets)
        .set({ isDeleted: true, deletedAt: ts, updatedAt: ts })
        .where(eq(schema.referenceAssets.id, rid));
      const record = {
        id: newId(TRASH_PREFIX),
        entityType: "reference" as const,
        entityId: rid,
        projectId: ref.projectId,
        deletedAt: ts,
        originalLocation: { category_id: null, category_name: "" },
        cascadeIds: { requests: [], batches: [], images: [] },
      };
      await tx.insert(schema.trashRecords).values(trashRecordToDb(record));
      return record;
    });

    return ok(record);
  } catch (e) {
    return errorResponse(e);
  }
}
