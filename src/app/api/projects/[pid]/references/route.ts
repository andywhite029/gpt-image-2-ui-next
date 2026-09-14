import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { badRequest, ok } from "@/lib/errors";
import { errorResponse, requireProject } from "@/lib/api-helpers";
import { ensureInit } from "@/lib/init";
import {
  ALLOWED_REFERENCE_MIMES,
  MAX_REFERENCE_COUNT,
  MAX_REFERENCE_SIZE,
  REFERENCE_PREFIX,
  REFERENCE_TYPE_UPLOADED,
  newId,
  nowMs,
} from "@/lib/id";
import { sanitizeFilename } from "@/lib/utils";
import { referenceAssetFromDb, referenceAssetToDb } from "@/lib/serialize";
import { referenceView } from "@/lib/generation";
import type { ReferenceAsset } from "@/types/entities";

const OUTPUTS_DIR = process.env.OUTPUTS_DIR || "public/outputs";

/** GET /api/projects/[pid]/references — 项目参考图库（未删，createdAt 倒序） */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ pid: string }> }
) {
  try {
    await ensureInit();
    const { pid } = await params;
    await requireProject(pid);

    const rows = await db
      .select()
      .from(schema.referenceAssets)
      .where(
        sql`${schema.referenceAssets.projectId} = ${pid} AND ${schema.referenceAssets.isDeleted} = 0`
      )
      .orderBy(sql`${schema.referenceAssets.createdAt} DESC`);

    return ok({ references: rows.map((r) => referenceView(referenceAssetFromDb(r))) });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * POST /api/projects/[pid]/references — multipart 上传。
 * formData.getAll("image") + getAll("image[]")；校验 ≤16 个、≤25MB、png/jpeg/webp；
 * 文件名 sanitizeFilename + 冲突 _2/_3 后缀；先全部写盘再逐个建记录，失败清理。
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ pid: string }> }
) {
  try {
    await ensureInit();
    const { pid } = await params;
    await requireProject(pid);

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      throw badRequest("请求必须是 multipart/form-data");
    }

    const incoming = [
      ...formData.getAll("image"),
      ...formData.getAll("image[]"),
    ].filter((f): f is File => f instanceof File);

    if (incoming.length > MAX_REFERENCE_COUNT) {
      throw badRequest(
        `一次最多上传 ${MAX_REFERENCE_COUNT} 张参考图`,
        "REFERENCE_COUNT_EXCEEDED"
      );
    }

    const files: Array<{ filename: string; content: Buffer; mimetype: string }> = [];
    for (const f of incoming) {
      const content = Buffer.from(await f.arrayBuffer());
      if (content.length > MAX_REFERENCE_SIZE) {
        throw badRequest("参考图不能超过 25 MB", "REFERENCE_SIZE_EXCEEDED");
      }
      // File.type 为空时从文件名后缀推断
      let mimetype = f.type || "";
      if (!mimetype) {
        const ext = path.extname(f.name || "").toLowerCase();
        if (ext === ".jpg" || ext === ".jpeg") mimetype = "image/jpeg";
        else if (ext === ".webp") mimetype = "image/webp";
        else mimetype = "image/png";
      }
      if (!(ALLOWED_REFERENCE_MIMES as readonly string[]).includes(mimetype)) {
        throw badRequest("参考图只支持 PNG、JPEG 或 WebP");
      }
      if (content.length === 0) throw badRequest("参考图文件为空");
      files.push({ filename: f.name || "reference", content, mimetype });
    }
    if (!files.length) {
      throw badRequest("请选择至少一张参考图片", "EMPTY_REFERENCE_UPLOAD");
    }

    const referencesDir = path.join(OUTPUTS_DIR, pid, "references");
    fs.mkdirSync(referencesDir, { recursive: true });

    const created: ReferenceAsset[] = [];
    const written: string[] = [];
    try {
      // 既有文件名集合（查重）
      const existingRows = await db
        .select({ filePath: schema.referenceAssets.filePath })
        .from(schema.referenceAssets)
        .where(eq(schema.referenceAssets.projectId, pid));
      const usedNames = new Set(
        existingRows.map((r) => path.posix.basename((r.filePath || "").replace(/\\/g, "/")))
      );

      // 先全部写盘
      const pending: Array<{
        safeName: string;
        original: string;
        content: Buffer;
        mimetype: string;
      }> = [];
      for (const item of files) {
        const suffix = path.extname(item.filename).toLowerCase();
        const validSuffix = [".png", ".jpg", ".jpeg", ".webp"].includes(suffix)
          ? suffix
          : ".png";
        const stem = sanitizeFilename(
          path.basename(item.filename, path.extname(item.filename))
        );
        let candidate = `${stem}${validSuffix}`;
        let index = 2;
        while (usedNames.has(candidate) || fs.existsSync(path.join(referencesDir, candidate))) {
          candidate = `${stem}_${index}${validSuffix}`;
          index += 1;
        }
        usedNames.add(candidate);
        fs.writeFileSync(path.join(referencesDir, candidate), item.content);
        written.push(candidate);
        pending.push({ safeName: candidate, original: item.filename, content: item.content, mimetype: item.mimetype });
      }

      // 再逐个建记录
      for (const item of pending) {
        const ts = nowMs();
        const ref: ReferenceAsset = {
          id: newId(REFERENCE_PREFIX),
          projectId: pid,
          type: REFERENCE_TYPE_UPLOADED,
          imageAssetId: null,
          filePath: `references/${item.safeName}`,
          originalFilename: path.basename(item.original || ""),
          name: sanitizeFilename(path.basename(item.original, path.extname(item.original))),
          mimetype: item.mimetype,
          fileSize: item.content.length,
          userNote: "",
          tags: [],
          isFavorited: false,
          createdAt: ts,
          updatedAt: ts,
          isDeleted: false,
          deletedAt: null,
          fileMissing: false,
        };
        await db.insert(schema.referenceAssets).values(referenceAssetToDb(ref));
        created.push(ref);
      }
    } catch (exc) {
      // 失败清理已写文件
      for (const name of written) {
        try {
          fs.unlinkSync(path.join(referencesDir, name));
        } catch {
          // ignore
        }
      }
      throw badRequest(`保存参考图失败：${exc instanceof Error ? exc.message : String(exc)}`);
    }

    return ok({ references: created.map(referenceView) }, 201);
  } catch (e) {
    return errorResponse(e);
  }
}
