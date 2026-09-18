import { NextRequest } from "next/server";
import { ok } from "@/lib/errors";
import { errorResponse } from "@/lib/api-helpers";
import { ensureInit } from "@/lib/init";
import { purgeTrash } from "@/lib/trash";

/** DELETE /api/trash/[entityType]/[eid]?force=1 — 彻底删除（默认引用检查 409；force 跳过检查并级联清理引用方） */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ entityType: string; eid: string }> }
) {
  try {
    await ensureInit();
    const { entityType, eid } = await params;
    const force = new URL(request.url).searchParams.get("force") === "1";
    const result = await purgeTrash(entityType, eid, force);
    return ok(result);
  } catch (e) {
    return errorResponse(e);
  }
}
