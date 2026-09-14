/**
 * API 路由共享辅助：统一 try/catch 错误处理、ID 校验、实体定位。
 */
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { ServiceError, badRequest, notFound } from "./errors";
import { validEntityId, PROJECT_PREFIX, CONVERSATION_PREFIX, IMAGE_PREFIX, REFERENCE_PREFIX, CATEGORY_PREFIX } from "./id";
import {
  imageAssetFromDb,
  referenceAssetFromDb,
  requestFromDb,
  batchFromDb,
  projectFromDb,
  conversationFromDb,
} from "./serialize";
import type {
  Batch,
  Conversation,
  ImageAsset,
  Project,
  ReferenceAsset,
} from "@/types/entities";
import type { Request as GenRequest } from "@/types/entities";

/** 统一错误 → Response（ServiceError 带状态码，其余 500）。 */
export function errorResponse(e: unknown): Response {
  if (e instanceof ServiceError) return e.toResponse();
  console.error(e);
  return Response.json(
    { success: false, error: "服务器内部错误", code: "INTERNAL_ERROR" },
    { status: 500 }
  );
}

/** 解析 JSON body；非对象抛 400。 */
export async function readJsonBody(request: globalThis.Request): Promise<Record<string, unknown>> {
  let data: unknown;
  try {
    data = await request.json();
  } catch {
    data = null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw badRequest("请求体必须是 JSON 对象", "VALIDATION_ERROR");
  }
  return data as Record<string, unknown>;
}

export function requireValidId(value: string, prefix: string, what: string): string {
  if (!validEntityId(value, prefix)) {
    throw new ServiceError(`非法的${what} ID`, "INVALID_REQUEST", 400, value);
  }
  return value;
}

export async function requireProject(pid: string): Promise<Project> {
  requireValidId(pid, PROJECT_PREFIX, "项目");
  const rows = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, pid))
    .limit(1);
  if (!rows[0]) throw notFound("项目不存在", "NOT_FOUND");
  return projectFromDb(rows[0]);
}

// ---------- 跨项目实体定位（asset 路径不含 pid 前缀） ----------

export async function locateImage(iid: string): Promise<ImageAsset> {
  requireValidId(iid, IMAGE_PREFIX, "图片");
  const rows = await db
    .select()
    .from(schema.imageAssets)
    .where(eq(schema.imageAssets.id, iid))
    .limit(1);
  if (!rows[0]) throw notFound("图片不存在", "NOT_FOUND");
  return imageAssetFromDb(rows[0]);
}

export async function locateReference(rid: string): Promise<ReferenceAsset> {
  requireValidId(rid, REFERENCE_PREFIX, "参考图");
  const rows = await db
    .select()
    .from(schema.referenceAssets)
    .where(eq(schema.referenceAssets.id, rid))
    .limit(1);
  if (!rows[0]) throw notFound("参考图不存在", "NOT_FOUND");
  return referenceAssetFromDb(rows[0]);
}

export async function locateConversation(cid: string): Promise<Conversation> {
  requireValidId(cid, CONVERSATION_PREFIX, "对话");
  const rows = await db
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.id, cid))
    .limit(1);
  if (!rows[0]) throw notFound("对话不存在", "NOT_FOUND");
  return conversationFromDb(rows[0]);
}

export async function locateRequest(rid: string): Promise<GenRequest> {
  requireValidId(rid, "req_", "请求");
  const rows = await db
    .select()
    .from(schema.requests)
    .where(eq(schema.requests.id, rid))
    .limit(1);
  if (!rows[0]) throw notFound("请求不存在", "NOT_FOUND");
  return requestFromDb(rows[0]);
}

export async function locateBatch(bid: string): Promise<Batch> {
  requireValidId(bid, "batch_", "批次");
  const rows = await db
    .select()
    .from(schema.batches)
    .where(eq(schema.batches.id, bid))
    .limit(1);
  if (!rows[0]) throw notFound("批次不存在", "NOT_FOUND");
  return batchFromDb(rows[0]);
}

/** 跨项目定位分类（/api/categories/[cid] 无 pid 前缀）。 */
export async function locateCategory(cid: string) {
  requireValidId(cid, CATEGORY_PREFIX, "分类");
  const rows = await db
    .select()
    .from(schema.categories)
    .where(eq(schema.categories.id, cid))
    .limit(1);
  if (!rows[0]) throw notFound("分类不存在", "NOT_FOUND");
  return rows[0];
}

/** truthy 查询参数解析（1/true/yes/on）。 */
export function truthy(value: string | null): boolean {
  return !!value && ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}
