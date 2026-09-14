import { v4 as uuidv4 } from "uuid";

// Entity ID prefixes — same as old workbench/entities.py
export const PROJECT_PREFIX = "proj_";
export const CATEGORY_PREFIX = "cat_";
export const CONVERSATION_PREFIX = "conv_";
export const REQUEST_PREFIX = "req_";
export const BATCH_PREFIX = "batch_";
export const IMAGE_PREFIX = "img_";
export const REFERENCE_PREFIX = "ref_";
export const TRASH_PREFIX = "trash_";

const ALL_PREFIXES = [
  PROJECT_PREFIX,
  CATEGORY_PREFIX,
  CONVERSATION_PREFIX,
  REQUEST_PREFIX,
  BATCH_PREFIX,
  IMAGE_PREFIX,
  REFERENCE_PREFIX,
  TRASH_PREFIX,
] as const;

const ID_RE = /^(proj_|cat_|conv_|req_|batch_|img_|ref_|trash_)[0-9a-f]{32}$/;

export function newId(prefix: string): string {
  if (!ALL_PREFIXES.includes(prefix as (typeof ALL_PREFIXES)[number])) {
    throw new Error(`未知实体前缀: ${prefix}`);
  }
  return prefix + uuidv4().replace(/-/g, "");
}

export function validEntityId(
  value: unknown,
  prefix?: string | null
): value is string {
  if (typeof value !== "string" || !ID_RE.test(value)) return false;
  if (prefix != null && !value.startsWith(prefix)) return false;
  return true;
}

export function nowMs(): number {
  return Date.now();
}

// Entity type constants
export const PROJECT_TYPE_VIDEO = "video_project";
export const PROJECT_TYPE_FREE = "free_creation";
export const PROJECT_TYPES = [PROJECT_TYPE_VIDEO, PROJECT_TYPE_FREE] as const;

export const ALLOWED_COUNTS = [1, 2, 4] as const;

export const MAX_REFERENCE_COUNT = 16;
export const MAX_REFERENCE_SIZE = 25 * 1024 * 1024;
export const ALLOWED_REFERENCE_MIMES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;
export const MIME_SUFFIX: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

// Status constants
export const STATUS_GENERATING = "generating";
export const STATUS_SUCCESS = "success";
export const STATUS_FAILED = "failed";
export const STATUS_UNKNOWN = "unknown";

// Reference types
export const REFERENCE_TYPE_UPLOADED = "uploaded";
export const REFERENCE_TYPE_FROM_GENERATION = "from_generation";

// Trash types
export const TRASH_TYPES = ["conversation", "image", "reference"] as const;

// Video project default categories
export const VIDEO_PROJECT_DEFAULT_CATEGORIES = [
  "角色参考",
  "场景参考",
  "分镜图",
  "风格参考",
];