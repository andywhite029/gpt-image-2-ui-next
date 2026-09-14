import { NextRequest } from "next/server";
import { ok, ServiceError } from "@/lib/errors";
import { errorResponse } from "@/lib/api-helpers";
import { ensureInit } from "@/lib/init";
import { validEntityId } from "@/lib/id";
import { editRetryPayload } from "@/lib/generation";

/** POST /api/requests/[rid]/edit-retry — 返回原始参数供前端回填（不调网关） */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ rid: string }> }
) {
  try {
    await ensureInit();
    const { rid } = await params;
    if (!validEntityId(rid, "req_")) {
      throw new ServiceError("非法的请求 ID", "INVALID_REQUEST", 400, rid);
    }
    return ok(await editRetryPayload(rid));
  } catch (e) {
    return errorResponse(e);
  }
}
