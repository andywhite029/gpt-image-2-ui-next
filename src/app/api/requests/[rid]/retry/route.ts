import { NextRequest } from "next/server";
import { ok, ServiceError } from "@/lib/errors";
import { errorResponse, readJsonBody } from "@/lib/api-helpers";
import { ensureInit } from "@/lib/init";
import { validEntityId } from "@/lib/id";
import { retry } from "@/lib/generation";

/** POST /api/requests/[rid]/retry — 从 requestSnapshot 重建新 request/batch（202） */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ rid: string }> }
) {
  try {
    await ensureInit();
    const { rid } = await params;
    if (!validEntityId(rid, "req_")) {
      throw new ServiceError("非法的请求 ID", "INVALID_REQUEST", 400, rid);
    }
    const data = await readJsonBody(request);
    const apiKey = data.api_key;
    if (typeof apiKey !== "string" || !apiKey.trim()) {
      throw new ServiceError("重试需要提供 API Key", "MISSING_API_KEY", 400);
    }
    const result = await retry(rid, apiKey);
    return ok(result, 202);
  } catch (e) {
    return errorResponse(e);
  }
}
