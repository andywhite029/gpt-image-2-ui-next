import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { notFound } from "@/lib/errors";
import { errorResponse, locateImage } from "@/lib/api-helpers";
import { ensureInit } from "@/lib/init";
import { buildResized, resolveFilePath } from "@/lib/storage";

const PREVIEW_LONG_EDGE = 1280;
const OUTPUTS_DIR = process.env.OUTPUTS_DIR || "public/outputs";

/** GET /api/images/[iid]/preview — 1280px 预览；用 sharp 现场生成，缓存到 thumbnails/{iid}_preview.jpg；失败回退原图；软删图片仍可读，供回收站预览 */
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
    if (!fs.existsSync(absPath)) throw notFound("图片文件不存在");

    // 按需生成 1280px 预览并缓存
    const previewRel = `thumbnails/${iid}_preview.jpg`;
    const absPreview = path.join(OUTPUTS_DIR, asset.projectId, previewRel);
    if (!fs.existsSync(absPreview)) {
      try {
        const thumbDir = path.join(OUTPUTS_DIR, asset.projectId, "thumbnails");
        fs.mkdirSync(thumbDir, { recursive: true });
        await buildResized(absPath, absPreview, PREVIEW_LONG_EDGE);
      } catch {
        // 生成失败回退原图
      }
    }
    if (fs.existsSync(absPreview)) {
      const content = fs.readFileSync(absPreview);
      return new Response(new Uint8Array(content), {
        headers: {
          "Content-Type": "image/jpeg",
          "Content-Length": String(content.length),
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    // 回退原图
    const content = fs.readFileSync(absPath);
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
