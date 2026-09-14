import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { ok, validationError } from "@/lib/errors";
import { errorResponse, readJsonBody, requireProject } from "@/lib/api-helpers";
import { ensureInit } from "@/lib/init";
import { nowMs } from "@/lib/id";
import { categoryFromDb } from "@/lib/serialize";

/** POST /api/projects/[pid]/categories/reorder — {ordered_ids} 重排 sort_order 0..n-1 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ pid: string }> }
) {
  try {
    await ensureInit();
    const { pid } = await params;
    await requireProject(pid);
    const data = await readJsonBody(request);

    const orderedIds = data.ordered_ids;
    if (
      !Array.isArray(orderedIds) ||
      !orderedIds.every((x) => typeof x === "string")
    ) {
      throw validationError("ordered_ids 必须是字符串数组");
    }

    await db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: schema.categories.id })
        .from(schema.categories)
        .where(eq(schema.categories.projectId, pid));
      const currentIds = rows.map((c) => c.id);

      if (new Set(orderedIds as string[]).size !== orderedIds.length) {
        throw validationError("ordered_ids 不能包含重复项");
      }
      if (
        new Set(orderedIds as string[]).size !== new Set(currentIds).size ||
        !(orderedIds as string[]).every((x) => currentIds.includes(x))
      ) {
        throw validationError("ordered_ids 必须与当前分类 ID 完全一致");
      }

      const now = nowMs();
      for (let i = 0; i < orderedIds.length; i++) {
        const cid = (orderedIds as string[])[i]!;
        await tx
          .update(schema.categories)
          .set({ sortOrder: i, updatedAt: now })
          .where(eq(schema.categories.id, cid));
      }
    });

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
