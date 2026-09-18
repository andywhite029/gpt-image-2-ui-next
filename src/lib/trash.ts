/**
 * 回收站业务（翻译自旧版 workbench/trash.py）。
 *
 * 规则：
 * - 两阶段删除：软删先进回收站（trash_records），确认后彻底删除；
 * - purge 前引用检查：图片被 sourceImageIds/from_generation 引用 → 409；
 *   参考图被 request.referenceAssetIds 引用 → 409；对话逐个检查级联图片（集合内互引不阻止）；
 * - force=true 跳过引用检查强删：图片强删时级联物理删其 from_generation 参考图
 *   （与图片共享文件，留着即悬空引用）；参考图强删不影响引用它的请求（快照字段可悬空，展示层已兜底）；
 * - 通过后物理删除 DB 记录 + outputs/thumbnails/references 下的文件；
 *   @legacy/ 前缀文件一律不动；from_generation 参考图与图片共享文件不动；
 * - restore：恢复 isDeleted=false，对话级联恢复，原分类存在则恢复 categoryId。
 */
import fs from "fs";
import path from "path";
import { and, eq, inArray, sql } from "drizzle-orm";
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
import type { ImageAsset, ReferenceAsset, TrashRecord } from "@/types/entities";

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

/** 图片的预览数据：url 用于行内缩略图，fullUrl 用于点击放大（1280px preview）。 */
function imagePreview(img: ImageAsset): { url: string; fullUrl: string } | null {
  if (img.fileMissing) return null;
  const fileUrl = `/api/images/${img.id}/file`;
  const url =
    img.thumbnailStatus === "ready" ? `/api/images/${img.id}/thumbnail` : fileUrl;
  return { url, fullUrl: `/api/images/${img.id}/preview` };
}

/** 回收站条目的预览数据：image/reference 单图，conversation 取级联图片前几张。 */
async function entityPreviews(
  record: TrashRecord
): Promise<Array<{ url: string; fullUrl: string; title: string }>> {
  try {
    if (record.entityType === "image") {
      const rows = await db
        .select()
        .from(schema.imageAssets)
        .where(eq(schema.imageAssets.id, record.entityId))
        .limit(1);
      const img = rows[0] ? imageAssetFromDb(rows[0]) : null;
      const p = img ? imagePreview(img) : null;
      return p ? [{ ...p, title: img!.id }] : [];
    }
    if (record.entityType === "reference") {
      const rows = await db
        .select()
        .from(schema.referenceAssets)
        .where(eq(schema.referenceAssets.id, record.entityId))
        .limit(1);
      const ref = rows[0] ? referenceAssetFromDb(rows[0]) : null;
      if (!ref || ref.fileMissing) return [];
      const url = `/api/references/${ref.id}/file`;
      return [{ url, fullUrl: url, title: ref.name || ref.id }];
    }
    // conversation：级联图片缩略图（最多 6 张，避免行内过长）
    const cascade = record.cascadeIds || { requests: [], batches: [], images: [] };
    const iids = (cascade.images || []).slice(0, 6);
    if (!iids.length) return [];
    const rows = await db
      .select()
      .from(schema.imageAssets)
      .where(inArray(schema.imageAssets.id, iids));
    const byId = new Map(rows.map((r) => [r.id, imageAssetFromDb(r)]));
    const previews: Array<{ url: string; fullUrl: string; title: string }> = [];
    for (const iid of iids) {
      const img = byId.get(iid);
      if (!img) continue;
      const p = imagePreview(img);
      if (p) previews.push({ ...p, title: img.id });
    }
    return previews;
  } catch {
    return [];
  }
}

/** 条目是否因被引用而无法彻底删除（与 purgeTrash 的检查口径一致，基于一次性快照内存计算）。 */
function computeBlocked(
  record: TrashRecord,
  projectImages: ImageAsset[],
  projectRefs: ReferenceAsset[],
  projectRequestRefIds: string[][]
): boolean {
  /** 与 imageReferrers 同口径：未删图片的 sourceImageIds + 未删 from_generation 参考图 */
  const imageReferrersIn = (imageId: string, excludeIds: Set<string>): boolean =>
    projectImages.some(
      (img) =>
        !excludeIds.has(img.id) && img.sourceImageIds.includes(imageId)
    ) ||
    projectRefs.some(
      (ref) => ref.type === "from_generation" && ref.imageAssetId === imageId
    );

  if (record.entityType === "image") {
    return imageReferrersIn(record.entityId, new Set([record.entityId]));
  }
  if (record.entityType === "conversation") {
    const cascadeImages = [...(record.cascadeIds?.images || [])];
    const exclude = new Set([...cascadeImages, record.entityId]);
    return cascadeImages.some((iid) => imageReferrersIn(iid, exclude));
  }
  // reference：被未删 request.referenceAssetIds 引用则 blocked
  return projectRequestRefIds.some((ids) => ids.includes(record.entityId));
}

/** GET /api/trash 的列表（附 entityTitle / projectName / previews / blocked）。 */
export async function listTrash() {
  const rows = await db
    .select()
    .from(schema.trashRecords)
    .orderBy(sql`${schema.trashRecords.deletedAt} DESC`);
  const projectRows = await db.select().from(schema.projects);
  const projectNames = new Map(projectRows.map((p) => [p.id, p.name]));

  // 引用检查快照：每个项目只加载一次（imageAssets/referenceAssets/requests 均为未删行）
  const imgRows = await db.select().from(schema.imageAssets);
  const refRows = await db.select().from(schema.referenceAssets);
  const reqRows = await db.select().from(schema.requests);
  const pushTo = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
    const arr = map.get(key);
    if (arr) arr.push(value);
    else map.set(key, [value]);
  };
  const imagesByProject = new Map<string, ImageAsset[]>();
  for (const r of imgRows) {
    if (!r.isDeleted) pushTo(imagesByProject, r.projectId, imageAssetFromDb(r));
  }
  const refsByProject = new Map<string, ReferenceAsset[]>();
  for (const r of refRows) {
    if (!r.isDeleted) pushTo(refsByProject, r.projectId, referenceAssetFromDb(r));
  }
  const requestRefIdsByProject = new Map<string, string[][]>();
  for (const r of reqRows) {
    if (r.isDeleted) continue;
    try {
      const ids = JSON.parse(r.referenceAssetIds || "[]");
      if (Array.isArray(ids)) pushTo(requestRefIdsByProject, r.projectId, ids);
    } catch {
      // ignore
    }
  }

  const items = await Promise.all(
    rows.map(async (r) => {
      const record = trashRecordFromDb(r);
      return {
        ...record,
        entityTitle: await entityTitle(record),
        projectName: projectNames.get(record.projectId) ?? "",
        previews: await entityPreviews(record),
        blocked: computeBlocked(
          record,
          imagesByProject.get(record.projectId) ?? [],
          refsByProject.get(record.projectId) ?? [],
          requestRefIdsByProject.get(record.projectId) ?? []
        ),
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

/** 删除图片的文件 + DB 记录；返回共享其文件的 from_generation 参考图 ID（供强删级联）。 */
async function purgeImage(
  pid: string,
  imageId: string
): Promise<string[]> {
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

  // from_generation 参考图与图片共享文件：图片没了它们即悬空，级联删掉
  const refRows = await db
    .select({ id: schema.referenceAssets.id })
    .from(schema.referenceAssets)
    .where(
      and(
        eq(schema.referenceAssets.projectId, pid),
        eq(schema.referenceAssets.imageAssetId, imageId)
      )
    );
  return refRows.map((r) => r.id);
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

/** 彻底删除实体（对话级联删除），并删除 TrashRecord。force=true 跳过引用检查并级联清理引用方。 */
export async function purgeTrash(entityType: string, entityId: string, force = false) {
  checkTrashParams(entityType, entityId);
  const record = await findTrashRecord(entityType, entityId);
  if (!record) throw notFound("回收站中不存在该记录");
  const pid = record.projectId;

  await db.transaction(async (tx) => {
    if (entityType === "image") {
      if (!force) {
        const referrers = await imageReferrers(pid, entityId, new Set([entityId]));
        raiseIfImageReferenced(referrers);
      }
      await tx.delete(schema.imageAssets).where(eq(schema.imageAssets.id, entityId));
    } else if (entityType === "conversation") {
      const cascade = record.cascadeIds || { requests: [], batches: [], images: [] };
      const cascadeImages = [...(cascade.images || [])];
      if (!force) {
        // 级联集合内的图片随对话一起删除，彼此引用不构成阻止
        const exclude = new Set([...cascadeImages, entityId]);
        for (const iid of cascadeImages) {
          const referrers = await imageReferrers(pid, iid, exclude);
          raiseIfImageReferenced(referrers);
        }
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
      // reference：被未删 request.referenceAssetIds 引用则 409（force 跳过；请求保留历史快照）
      if (!force) {
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
      }
      await tx.delete(schema.referenceAssets).where(eq(schema.referenceAssets.id, entityId));
    }

    // 事务内删记录，文件操作放事务外（失败也不回滚 DB——文件残留可接受）
    await tx.delete(schema.trashRecords).where(eq(schema.trashRecords.id, record.id));
  });

  // 文件清理（事务提交后）；from_generation 参考图级联物理删（含 DB 行 + 各自 trash 记录）
  const cascadeRefIds = new Set<string>();
  const collectRefs = async (iid: string) => {
    for (const rid of await purgeImage(pid, iid).catch(() => [] as string[])) {
      cascadeRefIds.add(rid);
    }
  };
  if (entityType === "image") {
    await collectRefs(entityId);
  } else if (entityType === "conversation") {
    const cascade = record.cascadeIds || { requests: [], batches: [], images: [] };
    for (const iid of cascade.images || []) {
      await collectRefs(iid);
    }
  } else {
    await purgeReference(pid, entityId).catch(() => undefined);
  }
  for (const rid of cascadeRefIds) {
    await purgeReference(pid, rid).catch(() => undefined);
    // 若该参考图自身也在回收站中，清掉对应 trash 记录避免悬空
    await db
      .delete(schema.trashRecords)
      .where(
        and(
          eq(schema.trashRecords.entityType, "reference"),
          eq(schema.trashRecords.entityId, rid)
        )
      )
      .catch(() => undefined);
  }

  return {
    entity_type: entityType,
    entity_id: entityId,
    project_id: pid,
    purged: true,
    force,
  };
}

/** 逐条 purge 全部回收站记录（force 强删，含被引用条目），收集失败列表。 */
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
      await purgeTrash(record.entityType, record.entityId, true);
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
