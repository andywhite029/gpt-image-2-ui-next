import { NextRequest } from "next/server";
import { ok, ServiceError } from "@/lib/errors";
import { errorResponse, readJsonBody } from "@/lib/api-helpers";
import { ensureInit } from "@/lib/init";
import { validEntityId } from "@/lib/id";
import { completeBatch } from "@/lib/generation";

/** POST /api/batches/[bid]/complete — 部分失败批次补齐（新 request/batch，isCompletion=true，202） */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ bid: string }> }
) {
  try {
    await ensureInit();
    const { bid } = await params;
    if (!validEntityId(bid, "batch_")) {
      throw new ServiceError("非法的批次 ID", "INVALID_REQUEST", 400, bid);
    }
    const data = await readJsonBody(request);
    const apiKey = data.api_key;
    if (typeof apiKey !== "string" || !apiKey.trim()) {
      throw new ServiceError("补齐需要提供 API Key", "MISSING_API_KEY", 400);
    }
    const result = await completeBatch(bid, apiKey);
    return ok(result, 202);
  } catch (e) {
    return errorResponse(e);
  }
}
