import path from "path";
import fs from "fs";

/**
 * 安全文件名：仅保留 letters, digits, Chinese chars, dots, dashes, underscores
 */
export function sanitizeFilename(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9一-鿿.\-_]/g, "_");
  return cleaned || "unnamed";
}

/**
 * 从 URL 路径推断文件后缀
 */
const SUFFIX_WHITELIST = ["png", "jpg", "jpeg", "webp", "gif"];

export function suffixFromUrl(url: string): string {
  const pathPart = url.split("?")[0]!.split("#")[0]!;
  if (pathPart.includes(".")) {
    const s = pathPart.split(".").pop()!.toLowerCase();
    if (SUFFIX_WHITELIST.includes(s)) return s;
  }
  return "png";
}

/**
 * MIME type → suffix
 */
export function mimetypeToSuffix(mime: string): string {
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
  };
  return map[mime] || ".png";
}

/**
 * suffix → MIME type
 */
export function suffixToMimetype(suffix: string): string {
  const map: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
  };
  return map[suffix.toLowerCase()] || "image/png";
}

/**
 * formatBytes — 格式化文件大小
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]!;
}

/**
 * 确保目录存在
 */
export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}