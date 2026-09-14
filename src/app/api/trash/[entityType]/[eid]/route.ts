import { NextRequest } from "next/server";
import { ok } from "@/lib/errors";
import { errorResponse } from "@/lib/api-helpers";
import { ensureInit } from "@/lib/init";
import { purgeTrash } from "@/lib/trash";

/** DELETE /api/trash/[entityType]/[eid] — 彻底删除（引用检查 409；物理删 JSON 记录+文件） */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ entityType: string; eid: string }> }
) {
  try {
    await ensureInit();
    const { entityType, eid } = await params;
    const result = await purgeTrash(entityType, eid);
    return ok(result);
  } catch (e) {
    return errorResponse(e);
  }
}
