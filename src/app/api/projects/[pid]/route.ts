import { NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { ok, validationError } from "@/lib/errors";
import { errorResponse, readJsonBody, requireProject } from "@/lib/api-helpers";
import { ensureInit } from "@/lib/init";
import { imageSummary } from "@/lib/generation";
import { categoryFromDb, conversationFromDb, projectFromDb } from "@/lib/serialize";
import type { ProjectOverview } from "@/types/entities";

/** GET /api/projects/[pid] — overview: project + categories + stats + recentConversations + recentImages */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ pid: string }> }
) {
  try {
    await ensureInit();
    const { pid } = await params;
    const project = await requireProject(pid);

    const catRows = await db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.projectId, pid));
    const categories = catRows
      .map(categoryFromDb)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt);

    const [convStats] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.conversations)
      .where(
        sql`${schema.conversations.projectId} = ${pid} AND ${schema.conversations.isDeleted} = 0`
      );
    const [imgStats] = await db
      .select({
        count: sql<number>`count(*)`,
        favorites: sql<number>`sum(case when ${schema.imageAssets.isFavorited} = 1 then 1 else 0 end)`,
      })
      .from(schema.imageAssets)
      .where(
        sql`${schema.imageAssets.projectId} = ${pid} AND ${schema.imageAssets.isDeleted} = 0`
      );
    const [refStats] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.referenceAssets)
      .where(
        sql`${schema.referenceAssets.projectId} = ${pid} AND ${schema.referenceAssets.isDeleted} = 0`
      );

    const recentConvRows = await db
      .select()
      .from(schema.conversations)
      .where(
        sql`${schema.conversations.projectId} = ${pid} AND ${schema.conversations.isDeleted} = 0`
      )
      .orderBy(sql`${schema.conversations.createdAt} DESC`)
      .limit(6);
    const recentConversations = recentConvRows.map(conversationFromDb);

    const recentImgRows = await db
      .select()
      .from(schema.imageAssets)
      .where(
        sql`${schema.imageAssets.projectId} = ${pid} AND ${schema.imageAssets.isDeleted} = 0`
      )
      .orderBy(sql`${schema.imageAssets.createdAt} DESC`)
      .limit(6);
    const recentImages = recentImgRows.map((r) =>
      imageSummary({
        id: r.id,
        projectId: r.projectId,
        categoryId: r.categoryId,
        conversationId: r.conversationId,
        requestId: r.requestId ?? "",
        batchId: r.batchId ?? "",
        filePath: r.filePath,
        thumbnailPath: r.thumbnailPath,
        thumbnailStatus: r.thumbnailStatus as "pending" | "ready" | "failed",
        mimetype: r.mimetype,
        fileSize: r.fileSize,
        sourceImageIds: [],
        batchSiblingIds: [],
        isFromFailedBatch: r.isFromFailedBatch,
        isReferenceAsset: r.isReferenceAsset,
        isFavorited: r.isFavorited,
        userNote: r.userNote,
        tags: [],
        fileMissing: r.fileMissing,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        isDeleted: r.isDeleted,
        deletedAt: r.deletedAt,
      })
    );

    const overview: ProjectOverview = {
      project,
      categories,
      stats: {
        conversations: convStats?.count ?? 0,
        images: imgStats?.count ?? 0,
        references: refStats?.count ?? 0,
        favorites: imgStats?.favorites ?? 0,
      },
      recentConversations,
      recentImages,
    };
    return ok(overview);
  } catch (e) {
    return errorResponse(e);
  }
}

/** PATCH /api/projects/[pid] — 改 name/description/hidden/archived */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ pid: string }> }
) {
  try {
    await ensureInit();
    const { pid } = await params;
    await requireProject(pid);
    const data = await readJsonBody(request);

    const updates: Partial<typeof schema.projects.$inferInsert> = {};
    if ("name" in data) {
      const name = data.name;
      if (typeof name !== "string" || !name.trim()) {
        throw validationError("项目名称不能为空");
      }
      updates.name = (name as string).trim();
    }
    if ("description" in data) {
      if (typeof data.description !== "string") {
        throw validationError("项目描述必须为字符串");
      }
      updates.description = data.description as string;
    }
    if ("hidden" in data) {
      if (typeof data.hidden !== "boolean") {
        throw validationError("hidden 必须为布尔值");
      }
      updates.hidden = data.hidden as boolean;
    }
    if ("archived" in data) {
      if (typeof data.archived !== "boolean") {
        throw validationError("archived 必须为布尔值");
      }
      updates.archived = data.archived as boolean;
    }
    updates.updatedAt = Date.now();

    await db.update(schema.projects).set(updates).where(eq(schema.projects.id, pid));
    const rows = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, pid))
      .limit(1);
    return ok({ project: projectFromDb(rows[0]!) });
  } catch (e) {
    return errorResponse(e);
  }
}

/** DELETE /api/projects/[pid] — 硬删除，SQLite FK cascade 级联清理子实体 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ pid: string }> }
) {
  try {
    await ensureInit();
    const { pid } = await params;
    await requireProject(pid);
    await db.delete(schema.projects).where(eq(schema.projects.id, pid));
    return ok({ deleted: true, projectId: pid });
  } catch (e) {
    return errorResponse(e);
  }
}
