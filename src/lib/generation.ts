/**
 * 生成编排器（翻译自旧版 workbench/generation.py）。
 *
 * 职责：
 * - submitGenerate：12 步校验（项目/对话/分类/prompt/能力/n/size/quality/幂等/参考资产/
 *   同对话并发限制）→ 事务内持久化 request + batch + 幂等记录 → fire-and-forget 异步执行；
 * - executeGeneration：网关调用 → 成功 processEntries / 失败 finalizeFailed / 超时 finalizeUnknown；
 * - retry（快照重建）/ editRetryPayload / completeBatch（部分失败补齐）/ recoverStale；
 * - 幂等：idempotency 表（projectId + clientRequestId 唯一索引），内容 hash 为规范化 payload 的 sha256。
 *
 * 锁纪律：SQLite（WAL + libsql）事务天然序列化写操作，无需进程内锁；
 * 网关调用在事务外（长时间 IO 不能持有事务）。
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import {
  ALLOWED_COUNTS,
  BATCH_PREFIX,
  CATEGORY_PREFIX,
  CONVERSATION_PREFIX,
  IMAGE_PREFIX,
  MAX_REFERENCE_COUNT,
  REFERENCE_PREFIX,
  REFERENCE_TYPE_FROM_GENERATION,
  REQUEST_PREFIX,
  STATUS_FAILED,
  STATUS_GENERATING,
  STATUS_SUCCESS,
  STATUS_UNKNOWN,
  newId,
  nowMs,
  validEntityId,
} from "./id";
import {
  badRequest,
  conflict,
  missingApiKey,
  notFound,
  validationError,
} from "./errors";
import {
  loadCapabilities,
  getConfig,
  getModelCapabilities,
  supportedSizes,
} from "./config";
import { callGenerate, GatewayTimeoutUnknown, type GenerateEntry } from "./gateway";
import { resolveFilePath, saveGeneratedImage } from "./storage";
import { mimetypeToSuffix, suffixToMimetype } from "./utils";
import {
  batchFromDb,
  batchToDb,
  imageAssetFromDb,
  imageAssetToDb,
  referenceAssetFromDb,
  referenceAssetToDb,
  requestFromDb,
  requestToDb,
} from "./serialize";
import type {
  Batch,
  ImageAsset,
  ImageSummary,
  ReferenceAsset,
  Request,
  RequestSnapshot,
} from "@/types/entities";

const DEFAULT_MODEL = "gpt-image-2";

// ---------- 图片摘要（与 assets.image_summary 同形状） ----------

export function imageSummary(asset: ImageAsset): ImageSummary {
  const iid = asset.id;
  const url = `/api/images/${iid}/file`;
  const thumbnailUrl =
    asset.thumbnailStatus === "ready" && asset.thumbnailPath
      ? `/api/images/${iid}/thumbnail`
      : null;
  const previewUrl =
    asset.filePath && !asset.fileMissing ? `/api/images/${iid}/preview` : null;
  return {
    ...asset,
    url,
    thumbnailUrl,
    previewUrl,
  };
}

// ---------- 参考图摘要视图 ----------

export function referenceView(ref: ReferenceAsset) {
  return { ...ref, url: `/api/references/${ref.id}/file` };
}

// ---------- 内容 hash ----------

export interface GeneratePayload {
  prompt?: unknown;
  negative_prompt?: unknown;
  size?: unknown;
  n?: unknown;
  quality?: unknown;
  model?: unknown;
  base_url?: unknown;
  reference_ids?: unknown;
  category_id?: unknown;
  api_key?: unknown;
  [key: string]: unknown;
}

function contentHash(payload: GeneratePayload, categoryId: string | null): string {
  const norm = {
    prompt: (payload.prompt as string) ?? null,
    negative_prompt: (payload.negative_prompt as string) ?? null,
    size: (payload.size as string) ?? null,
    n: (payload.n as number) ?? 1,
    quality: (payload.quality as string) ?? null,
    model: (payload.model as string) || DEFAULT_MODEL,
    base_url: (payload.base_url as string) ?? null,
    reference_ids: (payload.reference_ids as string[]) ?? [],
    category_id: categoryId,
  };
  const text = JSON.stringify(norm, Object.keys(norm).sort());
  return crypto.createHash("sha256").update(text, "utf-8").digest("hex");
}

// ---------- 参考图文件读取 ----------

function referenceFileExists(ref: ReferenceAsset): boolean {
  try {
    return fs.existsSync(resolveFilePath(ref.projectId, ref.filePath));
  } catch {
    return false;
  }
}

async function loadReference(projectId: string, rid: string): Promise<ReferenceAsset | null> {
  const rows = await db
    .select()
    .from(schema.referenceAssets)
    .where(
      and(
        eq(schema.referenceAssets.id, rid),
        eq(schema.referenceAssets.projectId, projectId)
      )
    )
    .limit(1);
  return rows[0] ? referenceAssetFromDb(rows[0]) : null;
}

/** 历史图片加入参考图库（from_generation，幂等：按 imageAssetId 查既有记录）。 */
export async function ensureFromGenerationReference(
  projectId: string,
  image: ImageAsset
): Promise<ReferenceAsset> {
  const existing = await db
    .select()
    .from(schema.referenceAssets)
    .where(
      and(
        eq(schema.referenceAssets.projectId, projectId),
        eq(schema.referenceAssets.type, REFERENCE_TYPE_FROM_GENERATION),
        eq(schema.referenceAssets.imageAssetId, image.id),
        eq(schema.referenceAssets.isDeleted, false)
      )
    )
    .limit(1);
  if (existing[0]) return referenceAssetFromDb(existing[0]);

  const ts = nowMs();
  const ref: ReferenceAsset = {
    id: newId(REFERENCE_PREFIX),
    projectId,
    type: REFERENCE_TYPE_FROM_GENERATION,
    imageAssetId: image.id,
    filePath: image.filePath || "",
    originalFilename: "",
    name: `生成图片 ${image.id.slice(0, 12)}`,
    mimetype: image.mimetype || "image/png",
    fileSize: image.fileSize || 0,
    userNote: "",
    tags: [],
    isFavorited: false,
    createdAt: ts,
    updatedAt: ts,
    isDeleted: false,
    deletedAt: null,
    fileMissing: false,
  };
  await db.insert(schema.referenceAssets).values(referenceAssetToDb(ref));
  return ref;
}

// ---------- 提交（事务内校验 + 持久化，事务外执行） ----------
// 参考资产校验在事务内完成（见 resolveReferenceIdsTx）：≤16、本项目、未删、
// 文件存在；img_ 自动建 from_generation 引用。

interface SubmitOptions {
  clientRequestId?: string | null;
  retryOfRequestId?: string | null;
  completionForBatchId?: string | null;
  isCompletion?: boolean;
  originalFailedBatchId?: string | null;
  restrictCount?: boolean;
  apiKey?: string | null;
}

async function submit(
  pid: string,
  cid: string,
  payload: GeneratePayload,
  opts: SubmitOptions
): Promise<{ request: Request; batch: Batch }> {
  const {
    clientRequestId = null,
    retryOfRequestId = null,
    completionForBatchId = null,
    isCompletion = false,
    originalFailedBatchId = null,
    restrictCount = true,
    apiKey = null,
  } = opts;

  if (typeof apiKey !== "string" || !apiKey.trim()) {
    throw missingApiKey();
  }

  const capabilities = loadCapabilities();

  // 整个读-改-写序列在一个事务内完成（SQLite 序列化写）
  const { request, batch } = await db.transaction(async (tx) => {
    // 1) 项目存在（ID 格式由路由层校验）
    const projRows = await tx
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, pid))
      .limit(1);
    if (!projRows[0]) throw notFound("项目不存在");

    // 2) 对话存在且未删
    const convRows = await tx
      .select()
      .from(schema.conversations)
      .where(
        and(eq(schema.conversations.id, cid), eq(schema.conversations.projectId, pid))
      )
      .limit(1);
    const conv = convRows[0];
    if (!conv || conv.isDeleted) throw notFound("对话不存在或已删除");

    // 3) 分类归属（payload 未给时用对话当前分类）
    let categoryId: string | null = (payload.category_id as string) ?? null;
    if (categoryId != null) {
      if (!validEntityId(categoryId, CATEGORY_PREFIX)) {
        throw validationError("非法分类 ID");
      }
      const catRows = await tx
        .select({ id: schema.categories.id })
        .from(schema.categories)
        .where(eq(schema.categories.projectId, pid));
      if (!catRows.some((c) => c.id === categoryId)) {
        throw validationError("分类不属于该项目");
      }
    } else {
      categoryId = conv.categoryId;
    }

    // 4) prompt 非空
    const prompt = payload.prompt;
    if (typeof prompt !== "string" || !prompt.trim()) {
      throw validationError("Prompt 不能为空");
    }
    const negative =
      typeof payload.negative_prompt === "string" && payload.negative_prompt.trim()
        ? (payload.negative_prompt as string)
        : null;

    // 5) 模型与能力
    const model = (typeof payload.model === "string" && payload.model) || DEFAULT_MODEL;
    const caps = getModelCapabilities(capabilities, model);

    // 6) n
    let n: number = payload.n == null ? 1 : (payload.n as number);
    if (typeof n === "boolean" || !Number.isInteger(n)) {
      throw validationError("生成数量 n 必须是整数");
    }
    if (restrictCount) {
      if (!(ALLOWED_COUNTS as readonly number[]).includes(n)) {
        throw validationError("生成数量仅支持 1 / 2 / 4");
      }
    } else if (!(n >= 1 && n <= 4)) {
      throw validationError("补齐数量必须在 1-4 之间");
    }

    // 7) size
    const size = payload.size;
    if (typeof size !== "string" || !supportedSizes(caps).includes(size)) {
      throw validationError(`尺寸 '${size}' 不在模型支持列表内`);
    }

    // 8) quality：能力不支持时照记用户选择、effective=None 不发送
    const qualityChoice =
      typeof payload.quality === "string" && payload.quality ? (payload.quality as string) : null;
    const supportsQuality = !!caps.supports_quality;
    let qualityEffective: string | null = null;
    if (supportsQuality) {
      const options = caps.quality_options || [];
      if (qualityChoice != null && !options.includes(qualityChoice)) {
        throw validationError(`quality '${qualityChoice}' 不在模型支持选项内`);
      }
      qualityEffective = qualityChoice;
    }
    const supportsNegative = !!caps.supports_negative_prompt;

    // 9) 幂等（同键同 hash 返回既有；同键异 hash 409）
    const hash = contentHash(payload, categoryId);
    let existingResult: { request: Request; batch: Batch } | null = null;
    if (clientRequestId) {
      const idemRows = await tx
        .select()
        .from(schema.idempotency)
        .where(
          and(
            eq(schema.idempotency.projectId, pid),
            eq(schema.idempotency.clientRequestId, clientRequestId)
          )
        )
        .limit(1);
      const rec = idemRows[0];
      if (rec) {
        if (rec.contentHash === hash) {
          const reqRows = await tx
            .select()
            .from(schema.requests)
            .where(eq(schema.requests.id, rec.requestId))
            .limit(1);
          const existing = reqRows[0] ? requestFromDb(reqRows[0]) : null;
          if (existing && !existing.isDeleted) {
            const batchRows = await tx
              .select()
              .from(schema.batches)
              .where(eq(schema.batches.id, existing.batchId))
              .limit(1);
            existingResult = {
              request: existing,
              batch: batchRows[0] ? batchFromDb(batchRows[0]) : null as unknown as Batch,
            };
          }
        } else {
          throw conflict("幂等键与已存在的请求内容不一致", "CONFLICT", rec.requestId);
        }
      }
    }

    // 10) 参考资产校验（≤16、本项目、未删、文件存在；img_ 自动建 from_generation 引用）
    const maxRefs = caps.max_reference_images || MAX_REFERENCE_COUNT;
    const refAssetIds = await resolveReferenceIdsTx(tx, pid, payload.reference_ids, maxRefs);

    // 11) 同对话并发限制（一个 generating batch）
    const busyRows = await tx
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
      throw conflict(
        "该对话已有生成中的批次，请等待完成后再提交",
        "CONVERSATION_BUSY",
        busy.id
      );
    }

    if (existingResult) return existingResult;

    // 12) 事务内持久化：request + batch + 幂等记录
    const ts = nowMs();
    const snapshot: RequestSnapshot = {
      prompt,
      negative_prompt: negative,
      size,
      n,
      quality: qualityChoice,
      model,
      base_url: typeof payload.base_url === "string" ? payload.base_url : undefined,
      reference_asset_ids: refAssetIds,
    };
    const parameters = {
      model,
      size,
      n,
      quality_user_choice: qualityChoice,
      quality_effective: qualityEffective,
      quality_supported: supportsQuality,
    };

    const requestId = newId(REQUEST_PREFIX);
    const batchId = newId(BATCH_PREFIX);

    const request: Request = {
      id: requestId,
      batchId,
      projectId: pid,
      categoryId,
      conversationId: cid,
      promptOriginal: prompt,
      promptEffective: prompt,
      negativePromptOriginal: negative,
      negativePromptEffective: supportsNegative ? negative : null,
      negativePromptSupported: supportsNegative,
      referenceAssetIds: refAssetIds,
      parameters,
      requestSnapshot: snapshot,
      idempotencyKey: clientRequestId || "",
      status: STATUS_GENERATING,
      errorMessage: null,
      unknownReason: null,
      retryOfRequestId,
      completionForBatchId,
      createdAt: ts,
      startedAt: ts,
      endedAt: null,
      isDeleted: false,
      deletedAt: null,
    };

    const batch: Batch = {
      id: batchId,
      requestId,
      projectId: pid,
      categoryId,
      conversationId: cid,
      targetCount: n,
      returnedCount: 0,
      savedCount: 0,
      status: STATUS_GENERATING,
      isCompletion,
      originalFailedBatchId,
      isCompleted: false,
      completionRequestIds: [],
      imageAssetIds: [],
      errorDetails: [],
      createdAt: ts,
      startedAt: ts,
      endedAt: null,
    };

    await tx.insert(schema.requests).values(requestToDb(request));
    await tx.insert(schema.batches).values(batchToDb(batch));
    await tx
      .update(schema.conversations)
      .set({ updatedAt: ts })
      .where(eq(schema.conversations.id, cid));
    if (clientRequestId) {
      await tx.insert(schema.idempotency).values({
        projectId: pid,
        clientRequestId,
        requestId,
        contentHash: hash,
        createdAt: ts,
      });
    }

    return { request, batch };
  });

  // 事务外 fire-and-forget 异步执行
  void executeGeneration(pid, request.id, batch.id, apiKey).catch((e) =>
    console.error("[generation] 后台执行异常:", e)
  );

  return { request, batch };
}

/**
 * resolveReferenceIds 的事务版本（img_ 自动建引用需要写库，故在事务内完成）。
 */
async function resolveReferenceIdsTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  projectId: string,
  raw: unknown,
  maxRefs: number
): Promise<string[]> {
  if (raw == null) raw = [];
  if (!Array.isArray(raw)) throw validationError("reference_ids 必须是列表");
  const deduped: string[] = [];
  for (const x of raw) {
    if (typeof x !== "string") throw validationError("参考图 ID 必须是字符串");
    if (!deduped.includes(x)) deduped.push(x);
  }
  if (deduped.length > maxRefs) {
    throw validationError(`参考图最多 ${maxRefs} 张`);
  }

  const refIds: string[] = [];
  for (const rid of deduped) {
    if (!validEntityId(rid)) throw validationError(`非法参考图 ID: ${rid}`);
    if (rid.startsWith(REFERENCE_PREFIX)) {
      const ref = await checkedReferenceTx(tx, projectId, rid);
      refIds.push(ref.id);
    } else if (rid.startsWith(IMAGE_PREFIX)) {
      const rows = await tx
        .select()
        .from(schema.imageAssets)
        .where(
          and(
            eq(schema.imageAssets.id, rid),
            eq(schema.imageAssets.projectId, projectId)
          )
        )
        .limit(1);
      const img = rows[0] ? imageAssetFromDb(rows[0]) : null;
      if (!img || img.isDeleted) {
        throw validationError("参考的历史图片不存在或已删除");
      }
      // 自动建立/复用 from_generation 关联（按 imageAssetId 幂等）
      const existing = await tx
        .select()
        .from(schema.referenceAssets)
        .where(
          and(
            eq(schema.referenceAssets.projectId, projectId),
            eq(schema.referenceAssets.type, REFERENCE_TYPE_FROM_GENERATION),
            eq(schema.referenceAssets.imageAssetId, img.id),
            eq(schema.referenceAssets.isDeleted, false)
          )
        )
        .limit(1);
      let ref: ReferenceAsset;
      if (existing[0]) {
        ref = referenceAssetFromDb(existing[0]);
      } else {
        const ts = nowMs();
        ref = {
          id: newId(REFERENCE_PREFIX),
          projectId,
          type: REFERENCE_TYPE_FROM_GENERATION,
          imageAssetId: img.id,
          filePath: img.filePath || "",
          originalFilename: "",
          name: `生成图片 ${img.id.slice(0, 12)}`,
          mimetype: img.mimetype || "image/png",
          fileSize: img.fileSize || 0,
          userNote: "",
          tags: [],
          isFavorited: false,
          createdAt: ts,
          updatedAt: ts,
          isDeleted: false,
          deletedAt: null,
          fileMissing: false,
        };
        await tx.insert(schema.referenceAssets).values(referenceAssetToDb(ref));
      }
      await checkedReferenceTx(tx, projectId, ref.id);
      refIds.push(ref.id);
    } else {
      throw validationError(
        `参考图 ID ${rid} 必须是参考图(ref_)或图片资产(img_)`
      );
    }
  }
  return refIds;
}

async function checkedReferenceTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  projectId: string,
  rid: string
): Promise<ReferenceAsset> {
  const rows = await tx
    .select()
    .from(schema.referenceAssets)
    .where(
      and(
        eq(schema.referenceAssets.id, rid),
        eq(schema.referenceAssets.projectId, projectId)
      )
    )
    .limit(1);
  const ref = rows[0] ? referenceAssetFromDb(rows[0]) : null;
  if (!ref || ref.isDeleted || ref.projectId !== projectId) {
    throw validationError(`参考图 ${rid} 不存在、已删除或不属于该项目`);
  }
  if (!referenceFileExists(ref)) {
    throw validationError(`参考图 ${rid} 的文件缺失`);
  }
  return ref;
}

// ---------- 公共 API ----------

export async function submitGenerate(
  pid: string,
  cid: string,
  payload: GeneratePayload,
  clientRequestId: string | null
): Promise<{ request: Request; batch: Batch }> {
  return submit(pid, cid, payload ?? {}, {
    clientRequestId,
    apiKey: typeof payload?.api_key === "string" ? payload.api_key : null,
  });
}

export async function retry(
  rid: string,
  apiKey: string | null
): Promise<{ request: Request; batch: Batch }> {
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    throw badRequest("重试需要提供 API Key", "MISSING_API_KEY");
  }
  const rows = await db
    .select()
    .from(schema.requests)
    .where(eq(schema.requests.id, rid))
    .limit(1);
  const request = rows[0] ? requestFromDb(rows[0]) : null;
  if (!request) throw notFound("请求不存在");
  if (request.isDeleted) throw notFound("请求不存在或已删除");

  const snap = request.requestSnapshot;
  const bad: string[] = [];
  for (const refId of snap.reference_asset_ids || []) {
    const ref = await loadReference(request.projectId, refId);
    if (!ref || ref.isDeleted || !referenceFileExists(ref)) bad.push(refId);
  }
  if (bad.length) {
    throw badRequest(
      "以下参考图已不可用，无法直接重试，请编辑后重试: " + bad.join(", ")
    );
  }

  const payload: GeneratePayload = {
    prompt: snap.prompt,
    negative_prompt: snap.negative_prompt,
    size: snap.size,
    n: snap.n,
    quality: snap.quality,
    reference_ids: [...(snap.reference_asset_ids || [])],
    model: snap.model,
    base_url: snap.base_url,
    category_id: request.categoryId,
  };
  return submit(request.projectId, request.conversationId, payload, {
    clientRequestId: null, // 幂等键不复用
    retryOfRequestId: rid,
    apiKey,
  });
}

export async function editRetryPayload(rid: string) {
  const rows = await db
    .select()
    .from(schema.requests)
    .where(eq(schema.requests.id, rid))
    .limit(1);
  const request = rows[0] ? requestFromDb(rows[0]) : null;
  if (!request) throw notFound("请求不存在");
  const snap = request.requestSnapshot;
  return {
    prompt: snap.prompt,
    negative_prompt: snap.negative_prompt,
    size: snap.size,
    n: snap.n,
    quality: snap.quality,
    reference_ids: [...(snap.reference_asset_ids || [])],
  };
}

export async function completeBatch(
  bid: string,
  apiKey: string | null
): Promise<{ request: Request; batch: Batch }> {
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    throw badRequest("补齐需要提供 API Key", "MISSING_API_KEY");
  }
  const rows = await db
    .select()
    .from(schema.batches)
    .where(eq(schema.batches.id, bid))
    .limit(1);
  const batch = rows[0] ? batchFromDb(rows[0]) : null;
  if (!batch) throw notFound("批次不存在");
  if (batch.status !== STATUS_FAILED) {
    throw badRequest("仅「失败且已有部分图片（0 < 保存数 < 目标数）」的批次可补齐");
  }
  const saved = batch.savedCount;
  const target = batch.targetCount;
  if (!(0 < saved && saved < target)) {
    throw badRequest("仅「失败且已有部分图片（0 < 保存数 < 目标数）」的批次可补齐");
  }

  const reqRows = await db
    .select()
    .from(schema.requests)
    .where(eq(schema.requests.id, batch.requestId))
    .limit(1);
  const request = reqRows[0] ? requestFromDb(reqRows[0]) : null;
  if (!request) throw notFound("批次关联的请求不存在");

  const snap = request.requestSnapshot;
  const missing = target - saved;
  const payload: GeneratePayload = {
    prompt: snap.prompt,
    negative_prompt: snap.negative_prompt,
    size: snap.size,
    n: missing, // 内部补齐允许 1-4
    quality: snap.quality,
    reference_ids: [...(snap.reference_asset_ids || [])],
    model: snap.model,
    base_url: snap.base_url,
    category_id: batch.categoryId,
  };
  return submit(batch.projectId, batch.conversationId, payload, {
    clientRequestId: null,
    completionForBatchId: batch.id,
    isCompletion: true,
    originalFailedBatchId: batch.id,
    restrictCount: false,
    apiKey,
  });
}

// ---------- 查询 API ----------

export async function getRequest(rid: string) {
  const rows = await db
    .select()
    .from(schema.requests)
    .where(eq(schema.requests.id, rid))
    .limit(1);
  const request = rows[0] ? requestFromDb(rows[0]) : null;
  if (!request) throw notFound("请求不存在");
  if (request.isDeleted) throw notFound("请求不存在或已删除");
  const batchRows = await db
    .select()
    .from(schema.batches)
    .where(eq(schema.batches.id, request.batchId))
    .limit(1);
  return {
    request,
    batch: batchRows[0] ? batchFromDb(batchRows[0]) : null,
  };
}

export async function getBatch(bid: string) {
  const rows = await db
    .select()
    .from(schema.batches)
    .where(eq(schema.batches.id, bid))
    .limit(1);
  const batch = rows[0] ? batchFromDb(rows[0]) : null;
  if (!batch) throw notFound("批次不存在");

  const reqRows = await db
    .select()
    .from(schema.requests)
    .where(eq(schema.requests.id, batch.requestId))
    .limit(1);
  const request = reqRows[0] ? requestFromDb(reqRows[0]) : null;

  const images: ImageSummary[] = [];
  if (batch.imageAssetIds.length) {
    const imgRows = await db
      .select()
      .from(schema.imageAssets)
      .where(eq(schema.imageAssets.batchId, bid));
    for (const iid of batch.imageAssetIds) {
      const row = imgRows.find((r) => r.id === iid);
      if (row) {
        const asset = imageAssetFromDb(row);
        if (!asset.isDeleted) images.push(imageSummary(asset));
      }
    }
  }
  return { batch, request, images };
}

// ---------- 启动恢复（src/lib/init.ts 默认用裸 SQL 实现，此处为 Drizzle 等价版本） ----------

export async function recoverStale(): Promise<number> {
  const ts = nowMs();
  const reason = "服务重启，结果未知";
  const updated = await db
    .update(schema.requests)
    .set({ status: STATUS_UNKNOWN, unknownReason: reason, endedAt: ts })
    .where(and(eq(schema.requests.status, STATUS_GENERATING), eq(schema.requests.isDeleted, false)))
    .returning({ id: schema.requests.id });
  await db
    .update(schema.batches)
    .set({ status: STATUS_UNKNOWN, endedAt: ts })
    .where(eq(schema.batches.status, STATUS_GENERATING));
  return updated.length;
}

// ---------- 异步执行 ----------

async function executeGeneration(
  pid: string,
  requestId: string,
  batchId: string,
  apiKey: string
): Promise<void> {
  try {
    const reqRows = await db
      .select()
      .from(schema.requests)
      .where(eq(schema.requests.id, requestId))
      .limit(1);
    const request = reqRows[0] ? requestFromDb(reqRows[0]) : null;
    const batchRows = await db
      .select()
      .from(schema.batches)
      .where(eq(schema.batches.id, batchId))
      .limit(1);
    const batch = batchRows[0] ? batchFromDb(batchRows[0]) : null;
    if (!request || !batch) return;

    // 网关调用期间可能已被删除（批次无独立软删标记，以 request.isDeleted 为准）
    if (request.isDeleted) return;

    // 解析参考图文件
    const references: Array<{
      filename: string;
      content: Buffer;
      mimetype: string;
    }> = [];
    for (const rid of request.referenceAssetIds) {
      const ref = await loadReference(pid, rid);
      if (!ref || ref.isDeleted) {
        throw new Error(`参考图 ${rid} 不可用`);
      }
      const abs = resolveFilePath(pid, ref.filePath);
      const content = fs.readFileSync(abs);
      references.push({
        filename: ref.name || path.basename(ref.filePath),
        content,
        mimetype: ref.mimetype || "image/png",
      });
    }

    const params = request.parameters as Record<string, unknown>;
    const snap = request.requestSnapshot;
    const { generationTimeout } = getConfig();
    const entries = await callGenerate({
      apiKey,
      baseUrl: snap.base_url ?? null,
      model: (params.model as string) ?? DEFAULT_MODEL,
      prompt: request.promptEffective,
      size: (params.size as string) ?? "1024x1024",
      n: (params.n as number) ?? 1,
      quality: (params.quality_effective as string) ?? null,
      negativePrompt: request.negativePromptEffective,
      references: references.length ? references : null,
      timeout: generationTimeout * 1000,
    });
    await processEntries(pid, request, batch, entries ?? []);
  } catch (e) {
    if (e instanceof GatewayTimeoutUnknown) {
      await finalizeUnknown(pid, requestId, batchId, e.message || "网关超时，结果未知");
      return;
    }
    // 其余（HTTP/响应错误/本地异常）均为明确失败
    const message =
      e instanceof Error
        ? `${e.message}${("detail" in e && (e as { detail?: string }).detail) ? `（详情： ${(e as { detail?: string }).detail}）` : ""}`
        : String(e);
    await finalizeFailed(pid, requestId, batchId, message);
  }
}

// ---------- 结果落盘 ----------

function summarizeErrors(
  errorDetails: Array<{ index: number; error: string }>
): string {
  return errorDetails
    .map((d) => {
      const label = typeof d.index === "number" ? `第 ${d.index + 1} 张` : "某张";
      return `${label}：${d.error || "未知原因"}`;
    })
    .join("；");
}

async function processEntries(
  pid: string,
  request: Request,
  batch: Batch,
  entries: GenerateEntry[]
): Promise<void> {
  // 网关调用期间对话/请求可能已被删除：先查一次，已删则丢弃结果不落盘
  const liveReq = await db
    .select({ isDeleted: schema.requests.isDeleted })
    .from(schema.requests)
    .where(eq(schema.requests.id, request.id))
    .limit(1);
  if (!liveReq[0] || liveReq[0].isDeleted) return;

  // source_image_ids = from_generation 引用的 image_asset_id
  const sourceIds: string[] = [];
  for (const rid of request.referenceAssetIds) {
    const ref = await loadReference(pid, rid);
    if (ref?.imageAssetId && !sourceIds.includes(ref.imageAssetId)) {
      sourceIds.push(ref.imageAssetId);
    }
  }

  // 逐条保存图片（文件系统操作，事务外）
  const savedAssets: ImageAsset[] = [];
  const errorDetails: Array<{ index: number; error: string }> = [...(batch.errorDetails || [])];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (entry.content && entry.content.length > 0) {
      const suffix = normalizeSuffix(entry.suffix || "png");
      const asset = await saveGeneratedImage({
        projectId: pid,
        categoryId: request.categoryId,
        conversationId: request.conversationId,
        requestId: request.id,
        batchId: batch.id,
        content: entry.content,
        suffix: `.${suffix}`,
        mimetype: suffixToMimetype(`.${suffix}`),
        sourceImageIds: sourceIds,
      });
      savedAssets.push(asset);
    } else {
      errorDetails.push({ index: i, error: entry.error || "图片内容为空" });
    }
  }

  // 同批图片互写 batchSiblingIds
  const savedIds = savedAssets.map((a) => a.id);
  for (const a of savedAssets) {
    a.batchSiblingIds = savedIds.filter((x) => x !== a.id);
  }

  // 网关返回数量不足 n 时，缺失部分按失败记录（无逐条错误信息）
  const target = batch.targetCount;
  const returnedN = entries.length;
  if (returnedN < target) {
    errorDetails.push({
      index: returnedN,
      error: `网关仅返回 ${returnedN} 张，目标 ${target} 张`,
    });
  }

  // 终态判定：saved==target → success；其余（部分成功/全没存下）→ failed
  const savedN = savedAssets.length;
  const status = savedN >= target ? STATUS_SUCCESS : STATUS_FAILED;
  for (const a of savedAssets) {
    a.isFromFailedBatch = status === STATUS_FAILED;
  }
  const errorMessage = status === STATUS_FAILED ? summarizeErrors(errorDetails) : null;
  const ts = nowMs();

  await db.transaction(async (tx) => {
    // 保存期间被删除：回滚刚写入的图片文件（记录尚未入库，无需删记录）
    const liveReqRows = await tx
      .select()
      .from(schema.requests)
      .where(eq(schema.requests.id, request.id))
      .limit(1);
    const liveBatchRows = await tx
      .select()
      .from(schema.batches)
      .where(eq(schema.batches.id, batch.id))
      .limit(1);
    if (
      !liveReqRows[0] ||
      liveReqRows[0].isDeleted ||
      !liveBatchRows[0]
    ) {
      for (const a of savedAssets) rollbackAsset(a);
      return;
    }

    for (const a of savedAssets) {
      await tx.insert(schema.imageAssets).values(imageAssetToDb(a));
    }
    await tx
      .update(schema.batches)
      .set({
        returnedCount: returnedN,
        savedCount: savedN,
        status,
        errorDetails: JSON.stringify(errorDetails),
        imageAssetIds: JSON.stringify(savedIds),
        endedAt: ts,
      })
      .where(eq(schema.batches.id, batch.id));
    await tx
      .update(schema.requests)
      .set({
        status,
        ...(errorMessage ? { errorMessage } : {}),
        endedAt: ts,
      })
      .where(eq(schema.requests.id, request.id));

    // 补齐：新图并入原失败批次
    const origBid = request.completionForBatchId;
    if (origBid) {
      const origRows = await tx
        .select()
        .from(schema.batches)
        .where(eq(schema.batches.id, origBid))
        .limit(1);
      const orig = origRows[0] ? batchFromDb(origRows[0]) : null;
      if (orig) {
        const origIds = [...orig.imageAssetIds];
        for (const a of savedAssets) {
          if (!origIds.includes(a.id)) origIds.push(a.id);
        }
        const origSaved = (orig.savedCount || 0) + savedN;
        const origReturned = (orig.returnedCount || 0) + returnedN;
        const crs = [...orig.completionRequestIds];
        if (!crs.includes(request.id)) crs.push(request.id);
        await tx
          .update(schema.batches)
          .set({
            imageAssetIds: JSON.stringify(origIds),
            savedCount: origSaved,
            returnedCount: origReturned,
            isCompleted: origSaved >= orig.targetCount, // 原 status 保持 failed
            completionRequestIds: JSON.stringify(crs),
          })
          .where(eq(schema.batches.id, origBid));
      }
    }

    // 对话自动命名：首次成功且仍默认标题
    if (status === STATUS_SUCCESS) {
      const convRows = await tx
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.id, request.conversationId))
        .limit(1);
      const conv = convRows[0];
      if (conv && !conv.isDeleted && !conv.titleCustom && conv.title === "新对话") {
        await tx
          .update(schema.conversations)
          .set({
            title: (request.promptOriginal || "").slice(0, 30),
            isInitial: false,
            updatedAt: ts,
          })
          .where(eq(schema.conversations.id, conv.id));
      }
    }
  });
}

function normalizeSuffix(suffix: string): string {
  const s = (suffix || "").toLowerCase().replace(/^\./, "");
  return ["png", "jpg", "jpeg", "webp", "gif"].includes(s) ? s : "png";
}

/** 删除一组刚写入但需回滚的图片文件（记录未入库时用）。 */
function rollbackAsset(a: ImageAsset): void {
  const OUTPUTS_DIR = process.env.OUTPUTS_DIR || "public/outputs";
  for (const rel of [a.filePath, a.thumbnailPath]) {
    if (!rel) continue;
    try {
      fs.unlinkSync(path.join(OUTPUTS_DIR, a.projectId, rel));
    } catch {
      // ignore
    }
  }
}

async function finalizeFailed(
  pid: string,
  requestId: string,
  batchId: string,
  message: string
): Promise<void> {
  await finalizeSimple(pid, requestId, batchId, STATUS_FAILED, {
    errorMessage: message,
  });
}

async function finalizeUnknown(
  pid: string,
  requestId: string,
  batchId: string,
  reason: string
): Promise<void> {
  await finalizeSimple(pid, requestId, batchId, STATUS_UNKNOWN, {
    unknownReason: reason,
  });
}

async function finalizeSimple(
  pid: string,
  requestId: string,
  batchId: string,
  status: string,
  fields: { errorMessage?: string; unknownReason?: string }
): Promise<void> {
  const ts = nowMs();
  await db.transaction(async (tx) => {
    const liveReqRows = await tx
      .select()
      .from(schema.requests)
      .where(eq(schema.requests.id, requestId))
      .limit(1);
    const liveBatchRows = await tx
      .select()
      .from(schema.batches)
      .where(eq(schema.batches.id, batchId))
      .limit(1);
    // 网关调用期间被删除，丢弃结果
    if (!liveReqRows[0] || liveReqRows[0].isDeleted || !liveBatchRows[0]) return;

    await tx
      .update(schema.requests)
      .set({
        status,
        ...(fields.errorMessage ? { errorMessage: fields.errorMessage } : {}),
        ...(fields.unknownReason ? { unknownReason: fields.unknownReason } : {}),
        endedAt: ts,
      })
      .where(eq(schema.requests.id, requestId));
    await tx
      .update(schema.batches)
      .set({ status, endedAt: ts })
      .where(eq(schema.batches.id, batchId));

    // 补齐请求失败：仍登记到原失败批次的 completion_request_ids
    const completionFor = liveReqRows[0].completionForBatchId;
    if (completionFor) {
      const origRows = await tx
        .select()
        .from(schema.batches)
        .where(eq(schema.batches.id, completionFor))
        .limit(1);
      const orig = origRows[0] ? batchFromDb(origRows[0]) : null;
      if (orig) {
        const crs = [...orig.completionRequestIds];
        if (!crs.includes(requestId)) crs.push(requestId);
        await tx
          .update(schema.batches)
          .set({ completionRequestIds: JSON.stringify(crs) })
          .where(eq(schema.batches.id, completionFor));
      }
    }
  });
}

// re-export mimetype helper for reuse in routes
export { mimetypeToSuffix };
