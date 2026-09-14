import { NextRequest } from "next/server";
import fs from "fs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { ok, validationError, notFound } from "@/lib/errors";
import { errorResponse, readJsonBody, locateImage } from "@/lib/api-helpers";
import { ensureInit } from "@/lib/init";
import { TRASH_PREFIX, newId, nowMs } from "@/lib/id";
import { imageSummary } from "@/lib/generation";
import { resolveFilePath } from "@/lib/storage";
import {
  imageAssetFromDb,
  referenceAssetFromDb,
  requestFromDb,
  trashRecordToDb,
} from "@/lib/serialize";

/** GET /api/images/[iid] — detail: image + sourceImages + batchSiblings + request 摘要 + referenceAssets + conversationTitle + categoryName */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ iid: string }> }
) {
  try {
    await ensureInit();
    const { iid } = await params;
    const asset = await locateImage(iid);
    if (asset.isDeleted) throw notFound("图片不存在或已被删除");

    // 来源图（含已删，已彻底删除则跳过）
    const sourceImages = [];
    for (const sid of asset.sourceImageIds) {
      const rows = await db
        .select()
        .from(schema.imageAssets)
        .where(eq(schema.imageAssets.id, sid))
        .limit(1);
      if (rows[0]) sourceImages.push(imageSummary(imageAssetFromDb(rows[0])));
    }

    // 同批次其他图（不含已删、不含自身）
    const siblingRows = await db
      .select()
      .from(schema.imageAssets)
      .where(eq(schema.imageAssets.batchId, asset.batchId));
    const batchSiblings = siblingRows
      .map(imageAssetFromDb)
      .filter((img) => img.id !== asset.id && !img.isDeleted)
      .map(imageSummary);

    // request 展示字段
    const request = asset.requestId
      ? (
          await db
            .select()
            .from(schema.requests)
            .where(eq(schema.requests.id, asset.requestId))
            .limit(1)
        )[0]
      : undefined;
    const reqEntity = request ? requestFromDb(request) : null;
    const requestView = reqEntity
      ? {
          id: reqEntity.id,
          prompt_original: reqEntity.promptOriginal,
          prompt_effective: reqEntity.promptEffective,
          parameters: reqEntity.parameters,
          negative_prompt_original: reqEntity.negativePromptOriginal,
        }
      : null;

    // 使用过的参考图：按 request.referenceAssetIds 解析摘要（缺失/已删如实返回）
    const referenceAssets = [];
    if (reqEntity) {
      for (const rid of reqEntity.referenceAssetIds) {
        const rows = await db
          .select()
          .from(schema.referenceAssets)
          .where(eq(schema.referenceAssets.id, rid))
          .limit(1);
        const ref = rows[0] ? referenceAssetFromDb(rows[0]) : null;
        if (!ref) {
          referenceAssets.push({
            id: rid,
            name: "（已删除）",
            type: "unknown",
            url: null,
            file_missing: true,
            is_deleted: true,
            image_asset_id: null,
          });
          continue;
        }
        let fileMissing = ref.fileMissing;
        if (!fileMissing) {
          try {
            fileMissing = !fs.existsSync(
              resolveFilePath(ref.projectId, ref.filePath)
            );
          } catch {
            fileMissing = true;
          }
        }
        referenceAssets.push({
          id: rid,
          name: ref.name,
          type: ref.type,
          url:
            !ref.isDeleted && !fileMissing ? `/api/references/${rid}/file` : null,
          file_missing: fileMissing,
          is_deleted: ref.isDeleted,
          image_asset_id: ref.imageAssetId,
        });
      }
    }

    const convRows = await db
      .select({ title: schema.conversations.title })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, asset.conversationId))
      .limit(1);
    const conversationTitle = convRows[0]?.title ?? null;

    let categoryName: string | null = null;
    if (asset.categoryId) {
      const catRows = await db
        .select({ name: schema.categories.name })
        .from(schema.categories)
        .where(eq(schema.categories.id, asset.categoryId))
        .limit(1);
      categoryName = catRows[0]?.name ?? null;
    }

    return ok({
      image: imageSummary(asset),
      source_images: sourceImages,
      batch_siblings: batchSiblings,
      request: requestView,
      reference_assets: referenceAssets,
      conversation_title: conversationTitle,
      category_name: categoryName,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/** PATCH /api/images/[iid] — 改 isFavorited / userNote / tags / categoryId */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ iid: string }> }
) {
  try {
    await ensureInit();
    const { iid } = await params;
    const asset = await locateImage(iid);
    if (asset.isDeleted) throw notFound("图片不存在或已被删除");
    const data = await readJsonBody(request);

    const updates: Record<string, unknown> = { updatedAt: nowMs() };
    if ("is_favorited" in data) {
      updates.isFavorited = !!data.is_favorited;
    }
    if ("user_note" in data) {
      const note = data.user_note;
      updates.userNote = note == null ? "" : String(note);
    }
    if ("tags" in data) {
      const tags = data.tags;
      if (
        !Array.isArray(tags) ||
        !(tags as unknown[]).every((t) => typeof t === "string")
      ) {
        throw validationError("标签必须是字符串数组");
      }
      updates.tags = JSON.stringify(tags);
    }
    if ("category_id" in data) {
      const categoryId = data.category_id;
      if (categoryId != null) {
        const rows = await db
          .select({ id: schema.categories.id })
          .from(schema.categories)
          .where(eq(schema.categories.projectId, asset.projectId));
        if (!rows.some((c) => c.id === categoryId)) {
          throw validationError("分类不存在或不属于当前项目");
        }
      }
      updates.categoryId = (categoryId as string | null) ?? null;
    }

    await db
      .update(schema.imageAssets)
      .set(updates as Partial<typeof schema.imageAssets.$inferInsert>)
      .where(eq(schema.imageAssets.id, iid));

    const rows = await db
      .select()
      .from(schema.imageAssets)
      .where(eq(schema.imageAssets.id, iid))
      .limit(1);
    return ok({ image: imageSummary(imageAssetFromDb(rows[0]!)) });
  } catch (e) {
    return errorResponse(e);
  }
}

/** DELETE /api/images/[iid] — 软删除 + trash */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ iid: string }> }
) {
  try {
    await ensureInit();
    const { iid } = await params;
    const asset = await locateImage(iid);
    if (asset.isDeleted) throw notFound("图片不存在或已被删除");

    const ts = nowMs();
    let categoryName = "";
    if (asset.categoryId) {
      const catRows = await db
        .select({ name: schema.categories.name })
        .from(schema.categories)
        .where(eq(schema.categories.id, asset.categoryId))
        .limit(1);
      categoryName = catRows[0]?.name ?? "";
    }

    const record = await db.transaction(async (tx) => {
      await tx
        .update(schema.imageAssets)
        .set({ isDeleted: true, deletedAt: ts, updatedAt: ts })
        .where(eq(schema.imageAssets.id, iid));
      const record = {
        id: newId(TRASH_PREFIX),
        entityType: "image" as const,
        entityId: iid,
        projectId: asset.projectId,
        deletedAt: ts,
        originalLocation: {
          category_id: asset.categoryId,
          category_name: categoryName,
        },
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
