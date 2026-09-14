/**
 * 回收站业务（翻译自旧版 workbench/trash.py）。
 *
 * 规则：
 * - 两阶段删除：软删先进回收站（trash_records），确认后彻底删除；
 * - purge 前引用检查：图片被 sourceImageIds/from_generation 引用 → 409；
 *   参考图被 request.referenceAssetIds 引用 → 409；对话逐个检查级联图片（集合内互引不阻止）；
 * - 通过后物理删除 DB 记录 + outputs/thumbnails/references 下的文件；
 *   @legacy/ 前缀文件一律不动；from_generation 参考图与图片共享文件不动；
 * - restore：恢复 isDeleted=false，对话级联恢复，原分类存在则恢复 categoryId。
 */
import fs from "fs";
import path from "path";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { ServiceError, badRequest, notFound } from "./errors";
import { TRASH_TYPES, validEntityId } from "./id";
import {
  conversationFromDb,
  imageAssetFromDb,
  referenceAssetFromDb,
  trashRecordFromDb,
  type ConversationRow,
  type ImageAssetRow,
  type ReferenceAssetRow,
} from "./serialize";
import type { TrashRecord } from "@/types/entities";

const LEGACY_PREFIX = "@legacy/";
const OUTPUTS_DIR = process.env.OUTPUTS_DIR || "public/outputs";

const ENTITY_TABLES = {
  conversation: schema.conversations,
  image: schema.imageAssets,
  reference: schema.referenceAssets,
} as const;

function absEntityFile(projectId: string, relPath: string): string {
  if (relPath.startsWith(LEGACY_PREFIX)) {
    return path.join(OUTPUTS_DIR, relPath.slice(LEGACY_PREFIX.length));
  }
  return path.join(OUTPUTS_DIR, projectId, relPath);
}

async function findTrashRecord(
  entityType: string,
  entityId: string
): Promise<TrashRecord | null> {
  const rows = await db
    .select()
    .from(schema.trashRecords)
    .where(
      and(
        eq(schema.trashRecords.entityType, entityType),
        eq(schema.trashRecords.entityId, entityId)
      )
    )
    .limit(1);
  return rows[0] ? trashRecordFromDb(rows[0]) : null;
}

function checkTrashParams(entityType: string, entityId: string): void {
  if (!(TRASH_TYPES as readonly string[]).includes(entityType)) {
    throw badRequest(`非法的回收站实体类型：${entityType}`);
  }
  if (!validEntityId(entityId)) {
    throw new ServiceError("非法的实体 ID", "INVALID_REQUEST", 400, entityId);
  }
}

/** 回收站列表展示名。 */
async function entityTitle(record: TrashRecord): Promise<string> {
  const table = ENTITY_TABLES[record.entityType];
  const rows = await db
    .select()
    .from(table)
    .where(eq(table.id, record.entityId))
    .limit(1);
  const row = rows[0];
  if (!row) return "（记录）";
  if (record.entityType === "conversation") {
    return conversationFromDb(row as ConversationRow).title || "（记录）";
  }
  if (record.entityType === "reference") {
    return referenceAssetFromDb(row as ReferenceAssetRow).name || "（记录）";
  }
  return record.entityId.slice(0, 12);
}

/** GET /api/trash 的列表（JOIN projects 取 projectName）。 */
export async function listTrash() {
  const rows = await db
    .select()
    .from(schema.trashRecords)
    .orderBy(sql`${schema.trashRecords.deletedAt} DESC`);
  const projectRows = await db.select().from(schema.projects);
  const projectNames = new Map(projectRows.map((p) => [p.id, p.name]));

  const items = await Promise.all(
    rows.map(async (r) => {
      const record = trashRecordFromDb(r);
      return {
        ...record,
        entityTitle: await entityTitle(record),
        projectName: projectNames.get(record.projectId) ?? "",
      };
    })
  );
  return items;
}

/** 恢复：撤销 isDeleted（对话级联恢复）；原分类存在则恢复归属，否则未分类。 */
export async function restoreTrash(entityType: string, entityId: string) {
  checkTrashParams(entityType, entityId);
  const record = await findTrashRecord(entityType, entityId);
  if (!record) throw notFound("回收站中不存在该记录");
  const pid = record.projectId;

  const entity = await db.transaction(async (tx) => {
    const table = ENTITY_TABLES[entityType as keyof typeof ENTITY_TABLES];
    const rows = await tx
      .select()
      .from(table)
      .where(eq(table.id, entityId))
      .limit(1);
    const row = rows[0];
    if (!row) throw notFound("记录对应的实体已不存在，无法恢复");

    const ts = Date.now();
    const updates: Record<string, unknown> = {
      isDeleted: false,
      deletedAt: null,
      updatedAt: ts,
    };

    // 原分类存在则恢复归属（conversation/image 有 categoryId）
    if ("categoryId" in row) {
      const originalCategory = record.originalLocation?.category_id ?? null;
      let restoredCategory: string | null = null;
      if (originalCategory && validEntityId(originalCategory, "cat_")) {
        const catRows = await tx
          .select({ id: schema.categories.id })
          .from(schema.categories)
          .where(
            and(
              eq(schema.categories.id, originalCategory),
              eq(schema.categories.projectId, pid)
            )
          )
          .limit(1);
        restoredCategory = catRows[0]?.id ?? null;
      }
      updates.categoryId = restoredCategory;
    }

    await tx
      .update(table)
      .set(updates as never)
      .where(eq(table.id, entityId));

    // 对话级联恢复
    if (entityType === "conversation") {
      const cascade = record.cascadeIds || { requests: [], batches: [], images: [] };
      for (const rid of cascade.requests || []) {
        await tx
          .update(schema.requests)
          .set({ isDeleted: false, deletedAt: null })
          .where(eq(schema.requests.id, rid));
      }
      // batches 表无 isDeleted 列：可见性由 request/conversation 驱动，无需恢复
      for (const iid of cascade.images || []) {
        await tx
          .update(schema.imageAssets)
          .set({ isDeleted: false, deletedAt: null, updatedAt: ts })
          .where(eq(schema.imageAssets.id, iid));
      }
    }

    await tx.delete(schema.trashRecords).where(eq(schema.trashRecords.id, record.id));
    return rows;
  });

  // 返回恢复的实体（重新加载）
  const table = ENTITY_TABLES[entityType as keyof typeof ENTITY_TABLES];
  const fresh = await db.select().from(table).where(eq(table.id, entityId)).limit(1);
  if (!fresh[0]) throw notFound("记录对应的实体已不存在，无法恢复");
  if (entityType === "conversation") return conversationFromDb(fresh[0] as ConversationRow);
  if (entityType === "reference") return referenceAssetFromDb(fresh[0] as ReferenceAssetRow);
  return imageAssetFromDb(fresh[0] as ImageAssetRow);
}

/** 查找仍引用图片 imageId 的未删实体：其他图片 sourceImageIds + from_generation 参考资产。 */
async function imageReferrers(
  pid: string,
  imageId: string,
  excludeIds: Set<string>
): Promise<string[]> {
  const referrers: string[] = [];
  const imgRows = await db
    .select()
    .from(schema.imageAssets)
    .where(eq(schema.imageAssets.projectId, pid));
  for (const row of imgRows) {
    if (row.isDeleted || excludeIds.has(row.id)) continue;
    const asset = imageAssetFromDb(row);
    if (asset.sourceImageIds.includes(imageId)) referrers.push(asset.id);
  }
  const refRows = await db
    .select()
    .from(schema.referenceAssets)
    .where(eq(schema.referenceAssets.projectId, pid));
  for (const row of refRows) {
    if (row.isDeleted) continue;
    const ref = referenceAssetFromDb(row);
    if (ref.type === "from_generation" && ref.imageAssetId === imageId) {
      referrers.push(ref.id);
    }
  }
  return referrers;
}

function raiseIfImageReferenced(referrers: string[]): void {
  if (referrers.length) {
    throw new ServiceError(
      "图片仍被其他资产引用，无法彻底删除，引用方：" + referrers.join("、"),
      "ENTITY_REFERENCED",
      409,
      JSON.stringify({ referrers })
    );
  }
}

function deleteOwnedBinary(pid: string, relPath: string | null, ownedPrefixes: string[]): void {
  if (!relPath) return;
  if (relPath.startsWith(LEGACY_PREFIX)) return;
  if (!ownedPrefixes.some((p) => relPath.startsWith(p))) return;
  try {
    fs.unlinkSync(absEntityFile(pid, relPath));
  } catch {
    // ignore
  }
}

async function purgeImage(pid: string, imageId: string): Promise<void> {
  const rows = await db
    .select()
    .from(schema.imageAssets)
    .where(eq(schema.imageAssets.id, imageId))
    .limit(1);
  if (rows[0]) {
    deleteOwnedBinary(pid, rows[0].filePath, ["outputs/"]);
    deleteOwnedBinary(pid, rows[0].thumbnailPath, ["thumbnails/"]);
    // 1280px 预览缓存（GET /api/images/[iid]/preview 按需生成）
    deleteOwnedBinary(pid, `thumbnails/${imageId}_preview.jpg`, ["thumbnails/"]);
  }
  await db.delete(schema.imageAssets).where(eq(schema.imageAssets.id, imageId));
}

async function purgeReference(pid: string, referenceId: string): Promise<void> {
  const rows = await db
    .select()
    .from(schema.referenceAssets)
    .where(eq(schema.referenceAssets.id, referenceId))
    .limit(1);
  if (rows[0]) {
    // 只有 uploaded 参考图拥有自己的文件；from_generation 与图片资产共享文件，不能删
    if (rows[0].type === "uploaded") {
      deleteOwnedBinary(pid, rows[0].filePath, ["references/"]);
    }
  }
  await db.delete(schema.referenceAssets).where(eq(schema.referenceAssets.id, referenceId));
}

/** 引用检查后彻底删除实体（对话级联删除），并删除 TrashRecord。 */
export async function purgeTrash(entityType: string, entityId: string) {
  checkTrashParams(entityType, entityId);
  const record = await findTrashRecord(entityType, entityId);
  if (!record) throw notFound("回收站中不存在该记录");
  const pid = record.projectId;

  await db.transaction(async (tx) => {
    if (entityType === "image") {
      const referrers = await imageReferrers(pid, entityId, new Set([entityId]));
      raiseIfImageReferenced(referrers);
      await tx.delete(schema.imageAssets).where(eq(schema.imageAssets.id, entityId));
    } else if (entityType === "conversation") {
      const cascade = record.cascadeIds || { requests: [], batches: [], images: [] };
      const cascadeImages = [...(cascade.images || [])];
      // 级联集合内的图片随对话一起删除，彼此引用不构成阻止
      const exclude = new Set([...cascadeImages, entityId]);
      for (const iid of cascadeImages) {
        const referrers = await imageReferrers(pid, iid, exclude);
        raiseIfImageReferenced(referrers);
      }
      await tx.delete(schema.conversations).where(eq(schema.conversations.id, entityId));
      for (const rid of cascade.requests || []) {
        await tx.delete(schema.requests).where(eq(schema.requests.id, rid));
      }
      for (const bid of cascade.batches || []) {
        await tx.delete(schema.batches).where(eq(schema.batches.id, bid));
      }
      for (const iid of cascadeImages) {
        await tx.delete(schema.imageAssets).where(eq(schema.imageAssets.id, iid));
      }
    } else {
      // reference：被未删 request.referenceAssetIds 引用则 409
      const referrers: string[] = [];
      const reqRows = await db
        .select()
        .from(schema.requests)
        .where(eq(schema.requests.projectId, pid));
      for (const row of reqRows) {
        if (row.isDeleted) continue;
        try {
          const ids = JSON.parse(row.referenceAssetIds || "[]");
          if (Array.isArray(ids) && ids.includes(entityId)) referrers.push(row.id);
        } catch {
          // ignore
        }
      }
      if (referrers.length) {
        throw new ServiceError(
          "参考图仍被生成请求引用，无法彻底删除，引用方：" + referrers.join("、"),
          "ENTITY_REFERENCED",
          409,
          JSON.stringify({ referrers })
        );
      }
      await tx.delete(schema.referenceAssets).where(eq(schema.referenceAssets.id, entityId));
    }

    // 事务内删记录，文件操作放事务外（失败也不回滚 DB——文件残留可接受）
    await tx.delete(schema.trashRecords).where(eq(schema.trashRecords.id, record.id));
  });

  // 文件清理（事务提交后）
  if (entityType === "image") {
    await purgeImage(pid, entityId).catch(() => undefined);
  } else if (entityType === "conversation") {
    const cascade = record.cascadeIds || { requests: [], batches: [], images: [] };
    for (const iid of cascade.images || []) {
      await purgeImage(pid, iid).catch(() => undefined);
    }
  } else {
    await purgeReference(pid, entityId).catch(() => undefined);
  }

  return {
    entity_type: entityType,
    entity_id: entityId,
    project_id: pid,
    purged: true,
  };
}

/** 逐条 purge 全部回收站记录，收集失败列表。 */
export async function emptyTrash() {
  const items = await listTrash();
  let purged = 0;
  const failed: Array<{
    id: string;
    entity_type: string;
    entity_id: string;
    error: string;
  }> = [];
  for (const record of items) {
    try {
      await purgeTrash(record.entityType, record.entityId);
      purged += 1;
    } catch (exc) {
      failed.push({
        id: record.id,
        entity_type: record.entityType,
        entity_id: record.entityId,
        error: exc instanceof Error ? exc.message : String(exc),
      });
    }
  }
  return { purged, failed };
}
