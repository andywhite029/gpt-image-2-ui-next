// Entity types — derived from old workbench/entities.py factory functions
// These are the "full" types as stored in DB. Frontend views use summary variants.

export interface Project {
  id: string;
  name: string;
  type: "video_project" | "free_creation";
  description: string;
  archived: boolean;
  hidden: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Category {
  id: string;
  projectId: string;
  name: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface Conversation {
  id: string;
  projectId: string;
  categoryId: string | null;
  title: string;
  isInitial: boolean;
  titleCustom: boolean;
  createdAt: number;
  updatedAt: number;
  isDeleted: boolean;
  deletedAt: number | null;
}

export interface Request {
  id: string;
  batchId: string;
  projectId: string;
  categoryId: string | null;
  conversationId: string;
  promptOriginal: string;
  promptEffective: string;
  negativePromptOriginal: string | null;
  negativePromptEffective: string | null;
  negativePromptSupported: boolean;
  referenceAssetIds: string[]; // stored as JSON string in DB
  parameters: Record<string, unknown>; // stored as JSON string
  requestSnapshot: RequestSnapshot; // stored as JSON string
  idempotencyKey: string;
  status: "generating" | "success" | "failed" | "unknown";
  errorMessage: string | null;
  unknownReason: string | null;
  retryOfRequestId: string | null;
  completionForBatchId: string | null;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  isDeleted: boolean;
  deletedAt: number | null;
}

export interface RequestSnapshot {
  prompt: string;
  negative_prompt: string | null;
  size: string;
  n: number;
  quality: string | null;
  model: string;
  base_url?: string;
  reference_asset_ids: string[];
}

export interface Batch {
  id: string;
  requestId: string;
  projectId: string;
  categoryId: string | null;
  conversationId: string;
  targetCount: number;
  returnedCount: number;
  savedCount: number;
  status: "generating" | "success" | "failed" | "unknown";
  isCompletion: boolean;
  originalFailedBatchId: string | null;
  isCompleted: boolean;
  completionRequestIds: string[]; // JSON
  imageAssetIds: string[]; // JSON
  errorDetails: Array<{ index: number; error: string }>; // JSON
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
}

export interface ImageAsset {
  id: string;
  projectId: string;
  categoryId: string | null;
  conversationId: string;
  requestId: string;
  batchId: string;
  filePath: string;
  thumbnailPath: string | null;
  thumbnailStatus: "pending" | "ready" | "failed";
  mimetype: string;
  fileSize: number;
  sourceImageIds: string[];
  batchSiblingIds: string[];
  isFromFailedBatch: boolean;
  isReferenceAsset: boolean;
  isFavorited: boolean;
  userNote: string;
  tags: string[];
  fileMissing: boolean;
  createdAt: number;
  updatedAt: number;
  isDeleted: boolean;
  deletedAt: number | null;
}

export interface ReferenceAsset {
  id: string;
  projectId: string;
  type: "uploaded" | "from_generation";
  imageAssetId: string | null;
  filePath: string;
  originalFilename: string;
  name: string;
  mimetype: string;
  fileSize: number;
  userNote: string;
  tags: string[];
  isFavorited: boolean;
  createdAt: number;
  updatedAt: number;
  isDeleted: boolean;
  deletedAt: number | null;
  fileMissing: boolean;
}

export interface TrashRecord {
  id: string;
  entityType: "conversation" | "image" | "reference";
  entityId: string;
  projectId: string;
  deletedAt: number;
  originalLocation: {
    category_id: string | null;
    category_name: string;
  };
  cascadeIds: {
    requests: string[];
    batches: string[];
    images: string[];
  };
}

export interface Template {
  id: number;
  name: string;
  prompt: string;
  negativePrompt: string;
  model: string;
  size: string;
  quality: string;
  n: number;
  createdAt: number;
  updatedAt: number;
}

// ========== Summary / View types (what the frontend consumes) ==========

export interface ImageSummary {
  id: string;
  projectId: string;
  categoryId: string | null;
  conversationId: string;
  requestId: string;
  batchId: string;
  url: string;
  thumbnailUrl: string | null;
  previewUrl: string | null;
  mimetype: string;
  fileSize: number;
  sourceImageIds: string[];
  batchSiblingIds: string[];
  isFromFailedBatch: boolean;
  isReferenceAsset: boolean;
  isFavorited: boolean;
  userNote: string;
  tags: string[];
  fileMissing: boolean;
  thumbnailStatus: string;
  createdAt: number;
  updatedAt: number;
  isDeleted: boolean;
  deletedAt: number | null;
}

export interface ReferenceSummary {
  id: string;
  projectId: string;
  type: string;
  imageAssetId: string | null;
  name: string;
  mimetype: string;
  fileSize: number;
  userNote: string;
  tags: string[];
  isFavorited: boolean;
  url: string;
  fileMissing: boolean;
  isDeleted: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ConversationRound {
  request: Request;
  batch: Batch | null;
  images: ImageSummary[];
}

export interface ProjectOverview {
  project: Project;
  categories: Category[];
  stats: {
    conversations: number;
    images: number;
    references: number;
    favorites: number;
  };
  recentConversations: Conversation[];
  recentImages: ImageSummary[];
}

export interface TrashItem extends TrashRecord {
  entityTitle: string;
  projectName: string;
  /** 预览图（image/reference 单张；conversation 为级联图片缩略图）。url 行内缩略图，fullUrl 点击放大 */
  previews?: Array<{ url: string; fullUrl: string; title: string }>;
  /** 是否被引用而无法彻底删除（与 purge 引用检查口径一致） */
  blocked?: boolean;
}

export interface SearchResult {
  type: "project" | "category" | "conversation" | "request" | "image" | "reference";
  id: string;
  title: string;
  subtitle: string;
  projectId: string;
  projectName: string;
  categoryId: string | null;
  categoryName: string | null;
  conversationId: string | null;
  timestamp: number;
}