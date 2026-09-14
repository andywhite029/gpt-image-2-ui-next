import { NextRequest } from "next/server";
import { ok, validationError } from "@/lib/errors";
import { errorResponse, readJsonBody } from "@/lib/api-helpers";
import { ensureInit } from "@/lib/init";
import { moveConversation } from "@/lib/conversation-move";

/** POST /api/conversations/[cid]/move — 移动对话到目标项目/分类 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ cid: string }> }
) {
  try {
    await ensureInit();
    const { cid } = await params;
    const data = await readJsonBody(request);
    if (typeof data.project_id !== "string" || !data.project_id) {
      throw validationError("缺少目标项目 ID");
    }
    const categoryId = data.category_id == null ? null : String(data.category_id);
    const result = await moveConversation(cid, data.project_id, categoryId);
    return ok({ conversation: result.conversation, moved: result.moved });
  } catch (e) {
    return errorResponse(e);
  }
}
