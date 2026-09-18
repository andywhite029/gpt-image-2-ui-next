import { NextRequest } from "next/server";
import fs from "fs";
import { notFound } from "@/lib/errors";
import { errorResponse, locateImage } from "@/lib/api-helpers";
import { ensureInit } from "@/lib/init";
import { resolveFilePath } from "@/lib/storage";

/** GET /api/images/[iid]/file — 原图二进制（图片不可变，长缓存；软删图片仍可读，供回收站预览） */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ iid: string }> }
) {
  try {
    await ensureInit();
    const { iid } = await params;
    const asset = await locateImage(iid);
    if (asset.fileMissing) throw notFound("图片文件缺失");

    const absPath = resolveFilePath(asset.projectId, asset.filePath);
    let content: Buffer;
    try {
      content = fs.readFileSync(absPath);
    } catch {
      throw notFound("图片文件不存在");
    }

    return new Response(new Uint8Array(content), {
      headers: {
        "Content-Type": asset.mimetype || "image/png",
        "Content-Length": String(content.length),
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
