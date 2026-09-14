import { NextRequest } from "next/server";
import { ok } from "@/lib/errors";
import { errorResponse } from "@/lib/api-helpers";
import { ensureInit } from "@/lib/init";
import { emptyTrash, listTrash } from "@/lib/trash";

/** GET /api/trash — 列表（附 entityTitle + projectName） */
export async function GET(_request: NextRequest) {
  try {
    await ensureInit();
    const items = await listTrash();
    return ok({ items });
  } catch (e) {
    return errorResponse(e);
  }
}

/** DELETE /api/trash — 清空（逐条 purge，409 收集为 failed 数组） */
export async function DELETE(_request: NextRequest) {
  try {
    await ensureInit();
    const result = await emptyTrash();
    return ok(result);
  } catch (e) {
    return errorResponse(e);
  }
}
