import { NextRequest } from "next/server";
import { ok } from "@/lib/errors";
import { errorResponse } from "@/lib/api-helpers";
import { ensureInit } from "@/lib/init";
import { getRequest } from "@/lib/generation";

/** GET /api/requests/[rid] — request + batch */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ rid: string }> }
) {
  try {
    await ensureInit();
    const { rid } = await params;
    return ok(await getRequest(rid));
  } catch (e) {
    return errorResponse(e);
  }
}
