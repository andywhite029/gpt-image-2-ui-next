import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { ok, validationError } from "@/lib/errors";
import { errorResponse, readJsonBody, requireProject } from "@/lib/api-helpers";
import { ensureInit } from "@/lib/init";
import { CATEGORY_PREFIX, newId, nowMs } from "@/lib/id";
import { categoryFromDb } from "@/lib/serialize";

/** GET /api/projects/[pid]/categories — 按 sortOrder 排序 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ pid: string }> }
) {
  try {
    await ensureInit();
    const { pid } = await params;
    await requireProject(pid);
    const rows = await db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.projectId, pid));
    const categories = rows
      .map(categoryFromDb)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt);
    return ok({ categories });
  } catch (e) {
    return errorResponse(e);
  }
}

/** POST /api/projects/[pid]/categories — 创建（sort_order 缺省取 max+1） */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ pid: string }> }
) {
  try {
    await ensureInit();
    const { pid } = await params;
    await requireProject(pid);
    const data = await readJsonBody(request);

    const name = typeof data.name === "string" ? data.name.trim() : "";
    if (!name) throw validationError("分类名称不能为空");
    let sortOrder: number | undefined;
    if (data.sort_order != null) {
      if (typeof data.sort_order !== "number" || !Number.isInteger(data.sort_order)) {
        throw validationError("sort_order 必须为整数");
      }
      sortOrder = data.sort_order as number;
    }

    const category = await db.transaction(async (tx) => {
      if (sortOrder == null) {
        const rows = await tx
          .select({ sortOrder: schema.categories.sortOrder })
          .from(schema.categories)
          .where(eq(schema.categories.projectId, pid));
        sortOrder = rows.reduce((m, c) => Math.max(m, c.sortOrder), -1) + 1;
      }
      const ts = nowMs();
      const category = {
        id: newId(CATEGORY_PREFIX),
        projectId: pid,
        name,
        sortOrder,
        createdAt: ts,
        updatedAt: ts,
      };
      await tx.insert(schema.categories).values(category);
      return category;
    });

    return ok({ category }, 201);
  } catch (e) {
    return errorResponse(e);
  }
}
