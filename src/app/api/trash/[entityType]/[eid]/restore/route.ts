import { NextRequest } from "next/server";
import { ok } from "@/lib/errors";
import { errorResponse } from "@/lib/api-helpers";
import { ensureInit } from "@/lib/init";
import { restoreTrash } from "@/lib/trash";

/** POST /api/trash/[entityType]/[eid]/restore — 恢复（对话级联恢复，原分类存在则恢复归属） */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ entityType: string; eid: string }> }
) {
  try {
    await ensureInit();
    const { entityType, eid } = await params;
    const entity = await restoreTrash(entityType, eid);
    return ok(entity);
  } catch (e) {
    return errorResponse(e);
  }
}
