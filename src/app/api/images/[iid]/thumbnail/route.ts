import { NextRequest } from "next/server";
import fs from "fs";
import { notFound } from "@/lib/errors";
import { errorResponse, locateImage } from "@/lib/api-helpers";
import { ensureInit } from "@/lib/init";
import { resolveFilePath } from "@/lib/storage";

/** GET /api/images/[iid]/thumbnail — 512px JPEG 缩略图；不存在时 404 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ iid: string }> }
) {
  try {
    await ensureInit();
    const { iid } = await params;
    const asset = await locateImage(iid);
    if (asset.thumbnailStatus !== "ready" || !asset.thumbnailPath) {
      throw notFound("缩略图不存在");
    }
    const absPath = resolveFilePath(asset.projectId, asset.thumbnailPath);
    let content: Buffer;
    try {
      content = fs.readFileSync(absPath);
    } catch {
      throw notFound("缩略图不存在");
    }
    return new Response(new Uint8Array(content), {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(content.length),
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
