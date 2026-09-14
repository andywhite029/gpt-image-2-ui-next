import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// ========== projects ==========
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // 'free_creation' | 'video_project'
  description: text("description").notNull().default(""),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// ========== categories ==========
export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// ========== conversations ==========
export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  categoryId: text("category_id").references(() => categories.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull().default("新对话"),
  isInitial: integer("is_initial", { mode: "boolean" })
    .notNull()
    .default(false),
  titleCustom: integer("title_custom", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  isDeleted: integer("is_deleted", { mode: "boolean" })
    .notNull()
    .default(false),
  deletedAt: integer("deleted_at"),
});

// ========== requests ==========
export const requests = sqliteTable("requests", {
  id: text("id").primaryKey(),
  batchId: text("batch_id").notNull(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  categoryId: text("category_id"),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  promptOriginal: text("prompt_original").notNull(),
  promptEffective: text("prompt_effective").notNull(),
  negativePromptOriginal: text("negative_prompt_original"),
  negativePromptEffective: text("negative_prompt_effective"),
  negativePromptSupported: integer("negative_prompt_supported", {
    mode: "boolean",
  })
    .notNull()
    .default(false),
  referenceAssetIds: text("reference_asset_ids").notNull().default("[]"), // JSON array
  parameters: text("parameters").notNull().default("{}"), // JSON object
  requestSnapshot: text("request_snapshot").notNull().default("{}"), // JSON object
  idempotencyKey: text("idempotency_key").notNull().default(""),
  status: text("status").notNull().default("generating"),
  errorMessage: text("error_message"),
  unknownReason: text("unknown_reason"),
  retryOfRequestId: text("retry_of_request_id"),
  completionForBatchId: text("completion_for_batch_id"),
  createdAt: integer("created_at").notNull(),
  startedAt: integer("started_at"),
  endedAt: integer("ended_at"),
  isDeleted: integer("is_deleted", { mode: "boolean" })
    .notNull()
    .default(false),
  deletedAt: integer("deleted_at"),
});

// ========== batches ==========
export const batches = sqliteTable("batches", {
  id: text("id").primaryKey(),
  requestId: text("request_id")
    .notNull()
    .references(() => requests.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  categoryId: text("category_id"),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  targetCount: integer("target_count").notNull(),
  returnedCount: integer("returned_count").notNull().default(0),
  savedCount: integer("saved_count").notNull().default(0),
  status: text("status").notNull().default("generating"),
  isCompletion: integer("is_completion", { mode: "boolean" })
    .notNull()
    .default(false),
  originalFailedBatchId: text("original_failed_batch_id"),
  isCompleted: integer("is_completed", { mode: "boolean" })
    .notNull()
    .default(false),
  completionRequestIds: text("completion_request_ids").notNull().default("[]"),
  imageAssetIds: text("image_asset_ids").notNull().default("[]"),
  errorDetails: text("error_details").notNull().default("[]"),
  createdAt: integer("created_at").notNull(),
  startedAt: integer("started_at"),
  endedAt: integer("ended_at"),
});

// ========== image_assets ==========
export const imageAssets = sqliteTable("image_assets", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  categoryId: text("category_id"),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  requestId: text("request_id").references(() => requests.id, {
    onDelete: "set null",
  }),
  batchId: text("batch_id").references(() => batches.id, {
    onDelete: "set null",
  }),
  filePath: text("file_path").notNull(),
  thumbnailPath: text("thumbnail_path"),
  thumbnailStatus: text("thumbnail_status").notNull().default("pending"),
  mimetype: text("mimetype").notNull().default("image/png"),
  fileSize: integer("file_size").notNull().default(0),
  sourceImageIds: text("source_image_ids").notNull().default("[]"),
  batchSiblingIds: text("batch_sibling_ids").notNull().default("[]"),
  isFromFailedBatch: integer("is_from_failed_batch", { mode: "boolean" })
    .notNull()
    .default(false),
  isReferenceAsset: integer("is_reference_asset", { mode: "boolean" })
    .notNull()
    .default(false),
  isFavorited: integer("is_favorited", { mode: "boolean" })
    .notNull()
    .default(false),
  userNote: text("user_note").notNull().default(""),
  tags: text("tags").notNull().default("[]"),
  fileMissing: integer("file_missing", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  isDeleted: integer("is_deleted", { mode: "boolean" })
    .notNull()
    .default(false),
  deletedAt: integer("deleted_at"),
});

// ========== reference_assets ==========
export const referenceAssets = sqliteTable("reference_assets", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // 'uploaded' | 'from_generation'
  imageAssetId: text("image_asset_id"),
  filePath: text("file_path").notNull(),
  originalFilename: text("original_filename").notNull().default(""),
  name: text("name").notNull(),
  mimetype: text("mimetype").notNull().default("image/png"),
  fileSize: integer("file_size").notNull().default(0),
  userNote: text("user_note").notNull().default(""),
  tags: text("tags").notNull().default("[]"),
  isFavorited: integer("is_favorited", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  isDeleted: integer("is_deleted", { mode: "boolean" })
    .notNull()
    .default(false),
  deletedAt: integer("deleted_at"),
  fileMissing: integer("file_missing", { mode: "boolean" })
    .notNull()
    .default(false),
});

// ========== trash_records ==========
export const trashRecords = sqliteTable("trash_records", {
  id: text("id").primaryKey(),
  entityType: text("entity_type").notNull(), // 'conversation' | 'image' | 'reference'
  entityId: text("entity_id").notNull(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  deletedAt: integer("deleted_at").notNull(),
  originalLocation: text("original_location").notNull().default("{}"),
  cascadeIds: text("cascade_ids").notNull().default("{}"),
});

// ========== idempotency ==========
export const idempotency = sqliteTable(
  "idempotency",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    clientRequestId: text("client_request_id").notNull(),
    requestId: text("request_id").notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("uk_idem").on(table.projectId, table.clientRequestId)]
);

// ========== templates ==========
export const templates = sqliteTable("templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  prompt: text("prompt").notNull(),
  negativePrompt: text("negative_prompt").notNull().default(""),
  model: text("model").notNull().default("gpt-image-2"),
  size: text("size").notNull().default("1024x1024"),
  quality: text("quality").notNull().default(""),
  n: integer("n").notNull().default(1),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});