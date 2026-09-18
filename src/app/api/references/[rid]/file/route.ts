import { NextRequest } from "next/server";
import fs from "fs";
import { notFound } from "@/lib/errors";
import { errorResponse, locateReference } from "@/lib/api-helpers";
import { ensureInit } from "@/lib/init";
import { resolveFilePath } from "@/lib/storage";

/** GET /api/references/[rid]/file — 参考图二进制（不可变，长缓存；软删参考图仍可读，供回收站预览） */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ rid: string }> }
) {
  try {
    await ensureInit();
    const { rid } = await params;
    const ref = await locateReference(rid);
    if (ref.fileMissing) throw notFound("参考图文件缺失");

    const absPath = resolveFilePath(ref.projectId, ref.filePath);
    let content: Buffer;
    try {
      content = fs.readFileSync(absPath);
    } catch {
      throw notFound("参考图文件不存在");
    }

    return new Response(new Uint8Array(content), {
      headers: {
        "Content-Type": ref.mimetype || "image/png",
        "Content-Length": String(content.length),
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
