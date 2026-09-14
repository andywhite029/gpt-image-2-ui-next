/**
 * DB 行 <-> 实体对象 转换。
 *
 * JSON 字段（referenceAssetIds, parameters, requestSnapshot, completionRequestIds,
 * imageAssetIds, errorDetails, tags, sourceImageIds, batchSiblingIds, originalLocation,
 * cascadeIds）在 SQLite 中存 JSON 字符串；所有 parse 均有 try/catch 兜底。
 */
import * as schema from "@/db/schema";
import type {
  Batch,
  Category,
  Conversation,
  ImageAsset,
  Project,
  ReferenceAsset,
  Request,
  Template,
  TrashRecord,
  RequestSnapshot,
} from "@/types/entities";

// ---------- drizzle 行/插入类型 ----------

type ProjectRow = typeof schema.projects.$inferSelect;
type ProjectInsert = typeof schema.projects.$inferInsert;
type CategoryRow = typeof schema.categories.$inferSelect;
type CategoryInsert = typeof schema.categories.$inferInsert;
type ConversationRow = typeof schema.conversations.$inferSelect;
type ConversationInsert = typeof schema.conversations.$inferInsert;
type RequestRow = typeof schema.requests.$inferSelect;
type RequestInsert = typeof schema.requests.$inferInsert;
type BatchRow = typeof schema.batches.$inferSelect;
type BatchInsert = typeof schema.batches.$inferInsert;
type ImageAssetRow = typeof schema.imageAssets.$inferSelect;
type ImageAssetInsert = typeof schema.imageAssets.$inferInsert;
type ReferenceAssetRow = typeof schema.referenceAssets.$inferSelect;
type ReferenceAssetInsert = typeof schema.referenceAssets.$inferInsert;
type TrashRecordRow = typeof schema.trashRecords.$inferSelect;
type TrashRecordInsert = typeof schema.trashRecords.$inferInsert;
type TemplateRow = typeof schema.templates.$inferSelect;

export type {
  ProjectRow,
  CategoryRow,
  ConversationRow,
  RequestRow,
  BatchRow,
  ImageAssetRow,
  ReferenceAssetRow,
  TrashRecordRow,
  TemplateRow,
};

// ---------- 通用 JSON 字段解析 ----------

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function parseJsonObject<T extends object>(
  raw: string | null | undefined,
  fallback: T
): T {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function parseErrorDetails(
  raw: string | null | undefined
): Array<{ index: number; error: string }> {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter(
      (x): x is { index: number; error: string } =>
        !!x &&
        typeof x === "object" &&
        typeof (x as Record<string, unknown>)["index"] === "number" &&
        typeof (x as Record<string, unknown>)["error"] === "string"
    );
  } catch {
    return [];
  }
}

export { parseJsonArray, parseJsonObject, parseErrorDetails };

// ---------- Project ----------

export function projectFromDb(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    type: row.type as Project["type"],
    description: row.description,
    archived: row.archived,
    hidden: row.hidden,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function projectToDb(p: Project): ProjectInsert {
  return { ...p };
}

// ---------- Category ----------

export function categoryFromDb(row: CategoryRow): Category {
  return { ...row };
}

export function categoryToDb(c: Category): CategoryInsert {
  return { ...c };
}

// ---------- Conversation ----------

export function conversationFromDb(row: ConversationRow): Conversation {
  return { ...row };
}

export function conversationToDb(c: Conversation): ConversationInsert {
  return { ...c };
}

// ---------- Request ----------

export function requestFromDb(row: RequestRow): Request {
  return {
    id: row.id,
    batchId: row.batchId,
    projectId: row.projectId,
    categoryId: row.categoryId,
    conversationId: row.conversationId,
    promptOriginal: row.promptOriginal,
    promptEffective: row.promptEffective,
    negativePromptOriginal: row.negativePromptOriginal,
    negativePromptEffective: row.negativePromptEffective,
    negativePromptSupported: row.negativePromptSupported,
    referenceAssetIds: parseJsonArray(row.referenceAssetIds),
    parameters: parseJsonObject<Record<string, unknown>>(row.parameters, {}),
    requestSnapshot: parseJsonObject<RequestSnapshot>(row.requestSnapshot, {
      prompt: "",
      negative_prompt: null,
      size: "",
      n: 1,
      quality: null,
      model: "gpt-image-2",
      reference_asset_ids: [],
    }),
    idempotencyKey: row.idempotencyKey,
    status: row.status as Request["status"],
    errorMessage: row.errorMessage,
    unknownReason: row.unknownReason,
    retryOfRequestId: row.retryOfRequestId,
    completionForBatchId: row.completionForBatchId,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    isDeleted: row.isDeleted,
    deletedAt: row.deletedAt,
  };
}

export function requestToDb(r: Request): RequestInsert {
  return {
    id: r.id,
    batchId: r.batchId,
    projectId: r.projectId,
    categoryId: r.categoryId,
    conversationId: r.conversationId,
    promptOriginal: r.promptOriginal,
    promptEffective: r.promptEffective,
    negativePromptOriginal: r.negativePromptOriginal,
    negativePromptEffective: r.negativePromptEffective,
    negativePromptSupported: r.negativePromptSupported,
    referenceAssetIds: JSON.stringify(r.referenceAssetIds),
    parameters: JSON.stringify(r.parameters ?? {}),
    requestSnapshot: JSON.stringify(r.requestSnapshot ?? {}),
    idempotencyKey: r.idempotencyKey ?? "",
    status: r.status,
    errorMessage: r.errorMessage,
    unknownReason: r.unknownReason,
    retryOfRequestId: r.retryOfRequestId,
    completionForBatchId: r.completionForBatchId,
    createdAt: r.createdAt,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    isDeleted: r.isDeleted,
    deletedAt: r.deletedAt,
  };
}

// ---------- Batch（batches 表无 isDeleted/deletedAt，软删由级联对话/请求承载） ----------

export function batchFromDb(row: BatchRow): Batch {
  return {
    id: row.id,
    requestId: row.requestId,
    projectId: row.projectId,
    categoryId: row.categoryId,
    conversationId: row.conversationId,
    targetCount: row.targetCount,
    returnedCount: row.returnedCount,
    savedCount: row.savedCount,
    status: row.status as Batch["status"],
    isCompletion: row.isCompletion,
    originalFailedBatchId: row.originalFailedBatchId,
    isCompleted: row.isCompleted,
    completionRequestIds: parseJsonArray(row.completionRequestIds),
    imageAssetIds: parseJsonArray(row.imageAssetIds),
    errorDetails: parseErrorDetails(row.errorDetails),
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
  };
}

export function batchToDb(b: Batch): BatchInsert {
  return {
    id: b.id,
    requestId: b.requestId,
    projectId: b.projectId,
    categoryId: b.categoryId,
    conversationId: b.conversationId,
    targetCount: b.targetCount,
    returnedCount: b.returnedCount,
    savedCount: b.savedCount,
    status: b.status,
    isCompletion: b.isCompletion,
    originalFailedBatchId: b.originalFailedBatchId,
    isCompleted: b.isCompleted,
    completionRequestIds: JSON.stringify(b.completionRequestIds ?? []),
    imageAssetIds: JSON.stringify(b.imageAssetIds ?? []),
    errorDetails: JSON.stringify(b.errorDetails ?? []),
    createdAt: b.createdAt,
    startedAt: b.startedAt,
    endedAt: b.endedAt,
  };
}

// ---------- ImageAsset ----------

export function imageAssetFromDb(row: ImageAssetRow): ImageAsset {
  return {
    id: row.id,
    projectId: row.projectId,
    categoryId: row.categoryId,
    conversationId: row.conversationId,
    // schema 中 requestId/batchId 可空（onDelete: set null），实体类型为非空 string
    requestId: row.requestId ?? "",
    batchId: row.batchId ?? "",
    filePath: row.filePath,
    thumbnailPath: row.thumbnailPath,
    thumbnailStatus: row.thumbnailStatus as ImageAsset["thumbnailStatus"],
    mimetype: row.mimetype,
    fileSize: row.fileSize,
    sourceImageIds: parseJsonArray(row.sourceImageIds),
    batchSiblingIds: parseJsonArray(row.batchSiblingIds),
    isFromFailedBatch: row.isFromFailedBatch,
    isReferenceAsset: row.isReferenceAsset,
    isFavorited: row.isFavorited,
    userNote: row.userNote,
    tags: parseJsonArray(row.tags),
    fileMissing: row.fileMissing,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    isDeleted: row.isDeleted,
    deletedAt: row.deletedAt,
  };
}

export function imageAssetToDb(a: ImageAsset): ImageAssetInsert {
  return {
    id: a.id,
    projectId: a.projectId,
    categoryId: a.categoryId,
    conversationId: a.conversationId,
    requestId: a.requestId,
    batchId: a.batchId,
    filePath: a.filePath,
    thumbnailPath: a.thumbnailPath,
    thumbnailStatus: a.thumbnailStatus,
    mimetype: a.mimetype,
    fileSize: a.fileSize,
    sourceImageIds: JSON.stringify(a.sourceImageIds ?? []),
    batchSiblingIds: JSON.stringify(a.batchSiblingIds ?? []),
    isFromFailedBatch: a.isFromFailedBatch,
    isReferenceAsset: a.isReferenceAsset,
    isFavorited: a.isFavorited,
    userNote: a.userNote,
    tags: JSON.stringify(a.tags ?? []),
    fileMissing: a.fileMissing,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    isDeleted: a.isDeleted,
    deletedAt: a.deletedAt,
  };
}

// ---------- ReferenceAsset ----------

export function referenceAssetFromDb(row: ReferenceAssetRow): ReferenceAsset {
  return {
    id: row.id,
    projectId: row.projectId,
    type: row.type as ReferenceAsset["type"],
    imageAssetId: row.imageAssetId,
    filePath: row.filePath,
    originalFilename: row.originalFilename,
    name: row.name,
    mimetype: row.mimetype,
    fileSize: row.fileSize,
    userNote: row.userNote,
    tags: parseJsonArray(row.tags),
    isFavorited: row.isFavorited,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    isDeleted: row.isDeleted,
    deletedAt: row.deletedAt,
    fileMissing: row.fileMissing,
  };
}

export function referenceAssetToDb(r: ReferenceAsset): ReferenceAssetInsert {
  return {
    id: r.id,
    projectId: r.projectId,
    type: r.type,
    imageAssetId: r.imageAssetId,
    filePath: r.filePath,
    originalFilename: r.originalFilename,
    name: r.name,
    mimetype: r.mimetype,
    fileSize: r.fileSize,
    userNote: r.userNote,
    tags: JSON.stringify(r.tags ?? []),
    isFavorited: r.isFavorited,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    isDeleted: r.isDeleted,
    deletedAt: r.deletedAt,
    fileMissing: r.fileMissing,
  };
}

// ---------- TrashRecord ----------

export function trashRecordFromDb(row: TrashRecordRow): TrashRecord {
  return {
    id: row.id,
    entityType: row.entityType as TrashRecord["entityType"],
    entityId: row.entityId,
    projectId: row.projectId,
    deletedAt: row.deletedAt,
    originalLocation: parseJsonObject(row.originalLocation, {
      category_id: null,
      category_name: "",
    }),
    cascadeIds: parseJsonObject(row.cascadeIds, {
      requests: [],
      batches: [],
      images: [],
    }),
  };
}

export function trashRecordToDb(t: TrashRecord): TrashRecordInsert {
  return {
    id: t.id,
    entityType: t.entityType,
    entityId: t.entityId,
    projectId: t.projectId,
    deletedAt: t.deletedAt,
    originalLocation: JSON.stringify(t.originalLocation ?? {}),
    cascadeIds: JSON.stringify(t.cascadeIds ?? {}),
  };
}

// ---------- Template ----------

export function templateFromDb(row: TemplateRow): Template {
  return { ...row };
}
