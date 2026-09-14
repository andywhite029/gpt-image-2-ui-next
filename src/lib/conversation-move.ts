/**
 * 对话移动（跨项目 / 跨分类）。
 *
 * 策略：先移文件、后改 DB（文件移动无法进事务），失败反向补偿：
 * - 校验目标项目 / 分类归属；同项目同分类 → 幂等 no-op（moved=false）；
 * - 本对话有 generating 批次，或任一 generating 请求引用了本对话图片的
 *   from_generation 参考图 → 409，避免移动期间文件被并发读写；
 * - 跨项目移动时把图片文件 / 缩略图 / 预览缓存挪到目标项目目录
 *   （@legacy/ 前缀指向 outputs 根目录，一律不动）；
 * - DB 事务内同步 conversations / requests / batches / imageAssets /
 *   referenceAssets / trashRecords 的 projectId / categoryId。子实体 categoryId
 *   必须跟随更新——retry()/completeBatch() 按「分类属于请求所在项目」校验，
 *   残留旧项目的 categoryId 会导致重试/补齐被拒（见 generation.ts）；
 * - 事务失败时把已移动的文件按逆序移回（尽力而为），再抛出原错误。
 */
import fs from "fs";
import path from "path";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { ServiceError, conflict, notFound, validationError } from "./errors";
import {
  CATEGORY_PREFIX,
  REFERENCE_TYPE_FROM_GENERATION,
  STATUS_GENERATING,
  nowMs,
  validEntityId,
} from "./id";
import { locateConversation, requireProject } from "./api-helpers";
import { conversationFromDb, parseJsonArray } from "./serialize";
import type { Conversation } from "@/types/entities";

const LEGACY_PREFIX = "@legacy/";
const OUTPUTS_DIR = process.env.OUTPUTS_DIR || "public/outputs";

export interface MoveConversationResult {
  conversation: Conversation;
  moved: boolean;
  filesMoved: number;
  referencesMoved: number;
}

// ---------- 文件移动（跨项目） ----------

interface PlannedFileMove {
  fromAbs: string;
  toAbs: string;
}

/** 计划单个文件的跨项目移动；@legacy/ 不动，源缺失 / 目标已存在则跳过（幂等）。 */
function planFileMove(
  planned: PlannedFileMove[],
  fromPid: string,
  toPid: string,
  relPath: string
): void {
  if (relPath.startsWith(LEGACY_PREFIX)) return;
  const fromAbs = path.join(OUTPUTS_DIR, fromPid, relPath);
  const toAbs = path.join(OUTPUTS_DIR, toPid, relPath);
  if (!fs.existsSync(fromAbs) || fs.existsSync(toAbs)) return;
  planned.push({ fromAbs, toAbs });
}

/** 执行计划好的移动；任一失败先回滚已完成的再抛 500。 */
function applyFileMoves(planned: PlannedFileMove[]): PlannedFileMove[] {
  const done: PlannedFileMove[] = [];
  try {
    for (const m of planned) {
      fs.mkdirSync(path.dirname(m.toAbs), { recursive: true });
      fs.renameSync(m.fromAbs, m.toAbs);
      done.push(m);
    }
  } catch (e) {
    revertFileMoves(done);
    throw new ServiceError(
      "移动图片文件失败：" + (e instanceof Error ? e.message : String(e)),
      "FILE_MOVE_FAILED",
      500
    );
  }
  return done;
}

/** 逆序补偿已完成的移动（尽力而为，单项失败忽略）。 */
function revertFileMoves(done: PlannedFileMove[]): void {
  for (let i = done.length - 1; i >= 0; i--) {
    const m = done[i]!;
    try {
      fs.mkdirSync(path.dirname(m.fromAbs), { recursive: true });
      fs.renameSync(m.toAbs, m.fromAbs);
    } catch {
      // 补偿失败可接受：文件留在目标位置，重试移动时按幂等跳过
    }
  }
}

async function reloadConversation(cid: string): Promise<Conversation> {
  const rows = await db
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.id, cid))
    .limit(1);
  return conversationFromDb(rows[0]!);
}

// ---------- 主流程 ----------

export async function moveConversation(
  cid: string,
  targetProjectId: string,
  targetCategoryId: string | null
): Promise<MoveConversationResult> {
  // 1) 定位对话（ID 格式 + 存在性）
  const conv = await locateConversation(cid);
  if (conv.isDeleted) throw notFound("对话不存在或已删除");

  // 2) 目标项目存在
  await requireProject(targetProjectId);

  // 3) 目标分类归属（非空时必须属于目标项目）
  if (targetCategoryId != null) {
    if (!validEntityId(targetCategoryId, CATEGORY_PREFIX)) {
      throw validationError("分类不存在或不属于目标项目");
    }
    const catRows = await db
      .select({ id: schema.categories.id })
      .from(schema.categories)
      .where(eq(schema.categories.projectId, targetProjectId));
    if (!catRows.some((c) => c.id === targetCategoryId)) {
      throw validationError("分类不存在或不属于目标项目");
    }
  }

  // 4) 同项目同分类 → no-op
  if (
    conv.projectId === targetProjectId &&
    (conv.categoryId ?? null) === targetCategoryId
  ) {
    return { conversation: conv, moved: false, filesMoved: 0, referencesMoved: 0 };
  }

  // 5) 本对话生成中 → 409
  const busyRows = await db
    .select({ id: schema.batches.id })
    .from(schema.batches)
    .where(
      and(
        eq(schema.batches.conversationId, cid),
        eq(schema.batches.status, STATUS_GENERATING)
      )
    )
    .limit(1);
  const busy = busyRows[0];
  if (busy) {
    throw conflict("该对话正在生成中，请等待完成后再移动", "CONVERSATION_BUSY", busy.id);
  }

  // 6) 全部图片（含软删——文件仍在原项目目录下）
  const imgRows = await db
    .select()
    .from(schema.imageAssets)
    .where(eq(schema.imageAssets.conversationId, cid));
  const imgIds = imgRows.map((r) => r.id);

  // 7) from_generation 参考图（含软删；可由其他对话创建，引用本对话的图片）
  const refRows = imgIds.length
    ? await db
        .select()
        .from(schema.referenceAssets)
        .where(
          and(
            eq(schema.referenceAssets.type, REFERENCE_TYPE_FROM_GENERATION),
            inArray(schema.referenceAssets.imageAssetId, imgIds)
          )
        )
    : [];
  const refIds = refRows.map((r) => r.id);

  // 8) 生成中的请求引用了这些参考图 → 409（重试时需按请求项目读取参考图文件）
  const refIdSet = new Set(refIds);
  if (refIdSet.size) {
    const genRows = await db
      .select({ referenceAssetIds: schema.requests.referenceAssetIds })
      .from(schema.requests)
      .where(
        and(
          eq(schema.requests.status, STATUS_GENERATING),
          eq(schema.requests.isDeleted, false)
        )
      );
    for (const row of genRows) {
      const ids = parseJsonArray(row.referenceAssetIds);
      if (ids.some((rid) => refIdSet.has(rid))) {
        throw conflict(
          "有正在生成的请求引用了该对话的图片，请等待完成后再移动",
          "REFERENCED_BY_GENERATING"
        );
      }
    }
  }

  const now = nowMs();

  // 9) 同项目：仅改分类（子实体 categoryId 同步，文件不动）
  if (conv.projectId === targetProjectId) {
    await db.transaction(async (tx) => {
      await tx
        .update(schema.conversations)
        .set({ categoryId: targetCategoryId, updatedAt: now })
        .where(eq(schema.conversations.id, cid));
      await tx
        .update(schema.requests)
        .set({ categoryId: targetCategoryId })
        .where(eq(schema.requests.conversationId, cid));
      await tx
        .update(schema.batches)
        .set({ categoryId: targetCategoryId })
        .where(eq(schema.batches.conversationId, cid));
      await tx
        .update(schema.imageAssets)
        .set({ categoryId: targetCategoryId, updatedAt: now })
        .where(eq(schema.imageAssets.conversationId, cid));
    });
    const conversation = await reloadConversation(cid);
    return { conversation, moved: true, filesMoved: 0, referencesMoved: 0 };
  }

  // 10) 跨项目：先移文件（原图 / 缩略图 / 预览缓存；@legacy/ 不动）
  const fromPid = conv.projectId;
  const toPid = targetProjectId;
  const planned: PlannedFileMove[] = [];
  for (const row of imgRows) {
    planFileMove(planned, fromPid, toPid, row.filePath);
    if (row.thumbnailPath) {
      planFileMove(planned, fromPid, toPid, row.thumbnailPath);
    }
    // 1280px 预览缓存（GET /api/images/[iid]/preview 按需生成，不记 DB，
    // 同样按项目目录存放；源不存在时 planFileMove 自动跳过）
    planFileMove(planned, fromPid, toPid, `thumbnails/${row.id}_preview.jpg`);
  }
  const done = applyFileMoves(planned);

  // 11) DB 事务：projectId / categoryId 全量同步（子实体不得残留旧项目分类）
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(schema.conversations)
        .set({ projectId: toPid, categoryId: targetCategoryId, updatedAt: now })
        .where(eq(schema.conversations.id, cid));
      await tx
        .update(schema.requests)
        .set({ projectId: toPid, categoryId: targetCategoryId })
        .where(eq(schema.requests.conversationId, cid));
      await tx
        .update(schema.batches)
        .set({ projectId: toPid, categoryId: targetCategoryId })
        .where(eq(schema.batches.conversationId, cid));
      await tx
        .update(schema.imageAssets)
        .set({ projectId: toPid, categoryId: targetCategoryId, updatedAt: now })
        .where(eq(schema.imageAssets.conversationId, cid));
      if (refIds.length) {
        await tx
          .update(schema.referenceAssets)
          .set({ projectId: toPid, updatedAt: now })
          .where(inArray(schema.referenceAssets.id, refIds));
      }
      if (imgIds.length) {
        await tx
          .update(schema.trashRecords)
          .set({ projectId: toPid })
          .where(
            and(
              eq(schema.trashRecords.entityType, "image"),
              inArray(schema.trashRecords.entityId, imgIds)
            )
          );
      }
      if (refIds.length) {
        await tx
          .update(schema.trashRecords)
          .set({ projectId: toPid })
          .where(
            and(
              eq(schema.trashRecords.entityType, "reference"),
              inArray(schema.trashRecords.entityId, refIds)
            )
          );
      }
    });
  } catch (e) {
    // 12) 事务失败 → 回滚已移动的文件（尽力而为），原样抛出
    revertFileMoves(done);
    throw e;
  }

  // 13) 返回移动后的对话
  const conversation = await reloadConversation(cid);
  return {
    conversation,
    moved: true,
    filesMoved: done.length,
    referencesMoved: refIds.length,
  };
}
