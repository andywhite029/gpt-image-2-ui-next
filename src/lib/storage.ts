import path from "path";
import fs from "fs";
import sharp from "sharp";
import { v4 as uuidv4 } from "uuid";
import { ensureDir } from "./utils";
import { nowMs, newId, IMAGE_PREFIX } from "./id";
import type { ImageAsset } from "@/types/entities";

const OUTPUTS_DIR = process.env.OUTPUTS_DIR || "public/outputs";
const THUMBNAILS_DIR = "thumbnails";
const THUMBNAIL_SIZE = 512;
const PREVIEW_SIZE = 1280;

/**
 * 保存图片文件（UUID 命名，避免冲突）
 */
export function saveImageFile(
  projectId: string,
  content: Buffer,
  suffix: string
): { filePath: string; fileSize: number } {
  const filename = uuidv4().replace(/-/g, "") + suffix;
  // 存储统一使用 POSIX 分隔符（JSON 持久化 + URL/前缀匹配一致性）
  const filePath = `outputs/${filename}`;
  const absPath = path.join(OUTPUTS_DIR, projectId, filePath);
  // 建 absPath 的父目录：新建项目没有 outputs/ 子目录（迁移来的项目才有），不建会 ENOENT
  ensureDir(path.dirname(absPath));

  fs.writeFileSync(absPath, content);
  const fileSize = fs.statSync(absPath).size;

  return { filePath, fileSize };
}

/**
 * Build thumbnail (512px long edge, JPEG)
 */
export async function buildThumbnail(
  inputPath: string,
  outputPath: string
): Promise<void> {
  await sharp(inputPath)
    .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toFile(outputPath);
}

/**
 * Build resized preview (arbitrary long edge, JPEG)
 */
export async function buildResized(
  inputPath: string,
  outputPath: string,
  longEdge: number
): Promise<void> {
  await sharp(inputPath)
    .resize(longEdge, longEdge, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 92 })
    .toFile(outputPath);
}

/**
 * Full pipeline: save generated image, build thumbnail, return ImageAsset
 */
export async function saveGeneratedImage(params: {
  projectId: string;
  categoryId?: string | null;
  conversationId: string;
  requestId: string;
  batchId: string;
  content: Buffer;
  suffix: string;
  mimetype: string;
  sourceImageIds?: string[];
}): Promise<ImageAsset> {
  const ts = nowMs();
  const assetId = newId(IMAGE_PREFIX);

  const { filePath, fileSize } = saveImageFile(
    params.projectId,
    params.content,
    params.suffix
  );

  // Thumbnail (stored with POSIX separators for consistency)
  const thumbDir = path.join(OUTPUTS_DIR, params.projectId, THUMBNAILS_DIR);
  ensureDir(thumbDir);
  const thumbPath = `thumbnails/${assetId}.jpg`;
  let thumbnailStatus: "pending" | "ready" | "failed" = "pending";

  try {
    const absThumb = path.join(OUTPUTS_DIR, params.projectId, thumbPath);
    await buildThumbnail(
      path.join(OUTPUTS_DIR, params.projectId, filePath),
      absThumb
    );
    thumbnailStatus = "ready";
  } catch {
    thumbnailStatus = "failed";
  }

  return {
    id: assetId,
    projectId: params.projectId,
    categoryId: params.categoryId ?? null,
    conversationId: params.conversationId,
    requestId: params.requestId,
    batchId: params.batchId,
    filePath,
    thumbnailPath: thumbnailStatus === "ready" ? thumbPath : null,
    thumbnailStatus,
    mimetype: params.mimetype,
    fileSize,
    sourceImageIds: params.sourceImageIds ?? [],
    batchSiblingIds: [],
    isFromFailedBatch: false,
    isReferenceAsset: false,
    isFavorited: false,
    userNote: "",
    tags: [],
    fileMissing: false,
    createdAt: ts,
    updatedAt: ts,
    isDeleted: false,
    deletedAt: null,
  };
}

/**
 * 获取文件绝对路径
 */
export function resolveFilePath(
  projectId: string,
  relativePath: string
): string {
  // Legacy paths: @legacy/ prefix → read from legacy output directory
  if (relativePath.startsWith("@legacy/")) {
    return path.join(OUTPUTS_DIR, relativePath.replace("@legacy/", ""));
  }
  return path.join(OUTPUTS_DIR, projectId, relativePath);
}