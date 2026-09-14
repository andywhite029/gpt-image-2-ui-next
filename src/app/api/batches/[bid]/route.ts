import { NextRequest } from "next/server";
import { ok } from "@/lib/errors";
import { errorResponse } from "@/lib/api-helpers";
import { ensureInit } from "@/lib/init";
import { getBatch } from "@/lib/generation";

/** GET /api/batches/[bid] — batch + request + images */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ bid: string }> }
) {
  try {
    await ensureInit();
    const { bid } = await params;
    return ok(await getBatch(bid));
  } catch (e) {
    return errorResponse(e);
  }
}
