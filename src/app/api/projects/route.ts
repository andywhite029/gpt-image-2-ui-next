import { NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { ok } from "@/lib/errors";
import { validationError } from "@/lib/errors";
import { errorResponse, readJsonBody, truthy } from "@/lib/api-helpers";
import { ensureInit } from "@/lib/init";
import {
  CATEGORY_PREFIX,
  CONVERSATION_PREFIX,
  PROJECT_TYPES,
  VIDEO_PROJECT_DEFAULT_CATEGORIES,
  newId,
  nowMs,
} from "@/lib/id";
import { projectFromDb } from "@/lib/serialize";
import type { Project } from "@/types/entities";

/** GET /api/projects — 列表（附 counts: {conversations, images}），query: include_hidden */
export async function GET(request: NextRequest) {
  try {
    await ensureInit();
    const includeHidden = truthy(request.nextUrl.searchParams.get("include_hidden"));

    const rows = await db.select().from(schema.projects).orderBy(schema.projects.createdAt);
    const projects = rows.map(projectFromDb).filter(
      (p) => includeHidden || (!p.hidden && !p.archived)
    );

    // counts：对话数 + 图片数（未删）
    const items = await Promise.all(
      projects.map(async (p) => {
        const [convCount] = await db
          .select({ count: sql<number>`count(*)` })
          .from(schema.conversations)
          .where(
            sql`${schema.conversations.projectId} = ${p.id} AND ${schema.conversations.isDeleted} = 0`
          );
        const [imgCount] = await db
          .select({ count: sql<number>`count(*)` })
          .from(schema.imageAssets)
          .where(
            sql`${schema.imageAssets.projectId} = ${p.id} AND ${schema.imageAssets.isDeleted} = 0`
          );
        return {
          ...p,
          counts: {
            conversations: convCount?.count ?? 0,
            images: imgCount?.count ?? 0,
          },
        };
      })
    );

    // createdAt 倒序
    items.sort((a, b) => b.createdAt - a.createdAt);
    return ok({ projects: items });
  } catch (e) {
    return errorResponse(e);
  }
}

/** POST /api/projects — 创建；video_project 自动建 4 分类 + 初始对话 */
export async function POST(request: NextRequest) {
  try {
    await ensureInit();
    const data = await readJsonBody(request);
    const name = typeof data.name === "string" ? data.name.trim() : "";
    const projectType = (
      typeof data.type === "string" && data.type
        ? data.type
        : typeof data.project_type === "string"
          ? (data.project_type as string).trim()
          : ""
    );
    const description =
      typeof data.description === "string" ? data.description.trim() : "";

    if (!name) throw validationError("项目名称不能为空");
    if (!(PROJECT_TYPES as readonly string[]).includes(projectType)) {
      throw validationError(`项目类型必须为 ${PROJECT_TYPES.join(" 或 ")}`);
    }

    const ts = nowMs();
    const pid = newId("proj_");
    const project: Project = {
      id: pid,
      name,
      type: projectType as Project["type"],
      description,
      archived: false,
      hidden: false,
      createdAt: ts,
      updatedAt: ts,
    };

    await db.transaction(async (tx) => {
      await tx.insert(schema.projects).values({ ...project });
      if (projectType === "video_project") {
        for (let i = 0; i < VIDEO_PROJECT_DEFAULT_CATEGORIES.length; i++) {
          const catName = VIDEO_PROJECT_DEFAULT_CATEGORIES[i]!;
          await tx.insert(schema.categories).values({
            id: newId(CATEGORY_PREFIX),
            projectId: pid,
            name: catName,
            sortOrder: i,
            createdAt: ts,
            updatedAt: ts,
          });
        }
      }
      // 初始对话
      await tx.insert(schema.conversations).values({
        id: newId(CONVERSATION_PREFIX),
        projectId: pid,
        categoryId: null,
        title: "新对话",
        isInitial: true,
        titleCustom: false,
        createdAt: ts,
        updatedAt: ts,
        isDeleted: false,
        deletedAt: null,
      });
    });

    return ok({ project }, 201);
  } catch (e) {
    return errorResponse(e);
  }
}
