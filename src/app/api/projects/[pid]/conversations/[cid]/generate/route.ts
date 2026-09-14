import { NextRequest } from "next/server";
import { ok, ServiceError, validationError } from "@/lib/errors";
import { errorResponse, readJsonBody, requireProject } from "@/lib/api-helpers";
import { ensureInit } from "@/lib/init";
import { CONVERSATION_PREFIX, validEntityId } from "@/lib/id";
import { submitGenerate, type GeneratePayload } from "@/lib/generation";

/**
 * POST /api/projects/[pid]/conversations/[cid]/generate
 * 提交生成（202）；clientRequestId 可从 body.client_request_id 或 X-Client-Request-Id header 读。
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ pid: string; cid: string }> }
) {
  try {
    await ensureInit();
    const { pid, cid } = await params;
    await requireProject(pid);
    if (!validEntityId(cid, CONVERSATION_PREFIX)) {
      throw new ServiceError("非法的对话 ID", "INVALID_REQUEST", 400, cid);
    }

    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new ServiceError("该接口仅接受 JSON 请求", "INVALID_REQUEST", 400);
    }
    const data = await readJsonBody(request) as unknown as GeneratePayload;

    const clientRequestId =
      (typeof data.client_request_id === "string" && data.client_request_id) ||
      request.headers.get("X-Client-Request-Id") ||
      null;

    const result = await submitGenerate(pid, cid, data, clientRequestId);
    return ok(result, 202);
  } catch (e) {
    return errorResponse(e);
  }
}
