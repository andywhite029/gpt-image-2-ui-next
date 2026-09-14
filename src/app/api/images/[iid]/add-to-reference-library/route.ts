import { NextRequest } from "next/server";
import { notFound } from "@/lib/errors";
import { ok } from "@/lib/errors";
import { errorResponse, locateImage } from "@/lib/api-helpers";
import { ensureInit } from "@/lib/init";
import { ensureFromGenerationReference } from "@/lib/generation";
import { referenceView } from "@/lib/generation";

/** POST /api/images/[iid]/add-to-reference-library — 历史图片加入参考图库（from_generation，幂等） */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ iid: string }> }
) {
  try {
    await ensureInit();
    const { iid } = await params;
    const asset = await locateImage(iid);
    if (asset.isDeleted) throw notFound("图片不存在或已被删除");
    const ref = await ensureFromGenerationReference(asset.projectId, asset);
    return ok({ reference: referenceView(ref) });
  } catch (e) {
    return errorResponse(e);
  }
}
