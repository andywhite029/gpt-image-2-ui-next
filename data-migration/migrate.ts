/**
 * 数据迁移脚本：旧版 Flask 工作台 (gpt-image-2-ui) → Next.js 版 (gpt-image-2-ui-next)
 *
 * 用法：
 *   npx tsx data-migration/migrate.ts [--source <旧项目根目录>] [--db <sqlite路径>]
 *
 * 默认 --source 为 ../gpt-image-2-ui（与本仓库同级），
 * 默认 --db 读 .env.local 的 DATABASE_PATH，否则 data/app.db。
 *
 * 特性：
 *   - snake_case → camelCase 字段映射（直接以 SQL 列名插入，列名本身就是 snake_case）
 *   - 数组/对象字段 JSON.stringify 后存 TEXT
 *   - 二进制文件复制到 public/outputs/<projectId>/ 下（outputs/、thumbnails/、references/）
 *   - 幂等：已存在的项目 ID 整体跳过；templates 表按 name+prompt 判重跳过
 *   - 损坏 JSON 跳过并警告；空目录跳过
 *
 * 注意：不建表。请先运行 `npx drizzle-kit push`。
 */

import { createClient, type Client, type InArgs } from "@libsql/client";
import fs from "fs";
import path from "path";

// ========== 参数解析 ==========

function parseArgs(): { source: string; db: string } {
  const argv = process.argv.slice(2);
  let source = "";
  let db = "";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--source") {
      source = argv[++i] ?? "";
    } else if (arg === "--db") {
      db = argv[++i] ?? "";
    } else if (arg === "--help" || arg === "-h") {
      console.log("用法: npx tsx data-migration/migrate.ts [--source <旧项目根目录>] [--db <sqlite路径>]");
      process.exit(0);
    } else {
      console.warn(`未知参数: ${arg}（--help 查看用法）`);
    }
  }

  const root = process.cwd();
  const sourceDir = path.resolve(root, source || "../gpt-image-2-ui");

  let dbPath = db;
  if (!dbPath) {
    // 读 .env.local 的 DATABASE_PATH（不依赖 dotenv，手动解析足够）
    dbPath = readEnvLocal(root, "DATABASE_PATH") || "data/app.db";
  }

  return { source: sourceDir, db: path.resolve(root, dbPath) };
}

function readEnvLocal(root: string, key: string): string {
  for (const name of [".env.local", ".env"]) {
    const p = path.join(root, name);
    if (!fs.existsSync(p)) continue;
    try {
      const content = fs.readFileSync(p, "utf-8");
      for (const line of content.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (m && m[1] === key) {
          return m[2]!.replace(/^["']|["']$/g, "").trim();
        }
      }
    } catch {
      // 读取失败则忽略
    }
  }
  return "";
}

// ========== JSON 读取（损坏跳过） ==========

function readJsonFile<T>(filePath: string, label: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    // BOM 容错
    return JSON.parse(raw.replace(/^﻿/, "")) as T;
  } catch (err) {
    console.warn(`  [警告] 跳过损坏的 ${label}: ${filePath} (${(err as Error).message})`);
    return null;
  }
}

function listJsonFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

// ========== snake_case → camelCase ==========

function toCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** 递归转换对象所有 key 为 camelCase（浅层值保持原样：数组/嵌套对象也递归） */
function camelize<T>(value: T): unknown {
  if (Array.isArray(value)) return value.map(camelize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[toCamel(k)] = camelize(v);
    }
    return out;
  }
  return value;
}

// ========== 旧数据类型（snake_case 原样） ==========

interface OldProject {
  id: string;
  name: string;
  type: string;
  description: string;
  archived: boolean;
  hidden: boolean;
  created_at: number;
  updated_at: number;
}

interface OldCategory {
  id: string;
  project_id: string;
  name: string;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

interface OldConversation {
  id: string;
  project_id: string;
  category_id: string | null;
  title: string;
  is_initial: boolean;
  title_custom: boolean;
  created_at: number;
  updated_at: number;
  is_deleted: boolean;
  deleted_at: number | null;
  // request_ids / batch_ids 冗余字段，新 schema 不存储
  request_ids?: string[];
  batch_ids?: string[];
}

interface OldRequest {
  id: string;
  batch_id: string;
  project_id: string;
  category_id: string | null;
  conversation_id: string;
  prompt_original: string;
  prompt_effective: string;
  negative_prompt_original: string | null;
  negative_prompt_effective: string | null;
  negative_prompt_supported: boolean;
  reference_asset_ids: string[];
  parameters: Record<string, unknown>;
  request_snapshot: Record<string, unknown>;
  idempotency_key: string;
  status: string;
  error_message: string | null;
  unknown_reason: string | null;
  retry_of_request_id: string | null;
  completion_for_batch_id: string | null;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
  is_deleted: boolean;
  deleted_at: number | null;
  prompt_optimized?: string | null; // 旧字段，新 schema 无
}

interface OldBatch {
  id: string;
  request_id: string;
  project_id: string;
  category_id: string | null;
  conversation_id: string;
  target_count: number;
  returned_count: number;
  saved_count: number;
  status: string;
  is_completion: boolean;
  original_failed_batch_id: string | null;
  is_completed: boolean;
  completion_request_ids: string[];
  image_asset_ids: string[];
  error_details: unknown[];
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
}

interface OldImageAsset {
  id: string;
  project_id: string;
  category_id: string | null;
  conversation_id: string;
  request_id: string;
  batch_id: string;
  file_path: string;
  thumbnail_path: string | null;
  thumbnail_status: string;
  mimetype: string;
  file_size: number;
  source_image_ids: string[];
  batch_sibling_ids: string[];
  is_from_failed_batch: boolean;
  is_reference_asset: boolean;
  is_favorited: boolean;
  user_note: string;
  tags: string[];
  file_missing: boolean;
  created_at: number;
  updated_at: number;
  is_deleted: boolean;
  deleted_at: number | null;
}

interface OldReferenceAsset {
  id: string;
  project_id: string;
  type: string;
  image_asset_id: string | null;
  file_path: string;
  original_filename: string;
  name: string;
  mimetype: string;
  file_size: number;
  user_note: string;
  tags: string[];
  is_favorited: boolean;
  created_at: number;
  updated_at: number;
  is_deleted: boolean;
  deleted_at: number | null;
  file_missing: boolean;
}

interface OldTrashRecord {
  id: string;
  entity_type: string;
  entity_id: string;
  project_id: string;
  deleted_at: number;
  original_location: Record<string, unknown>;
  cascade_ids: Record<string, unknown>;
}

interface OldIdempotencyEntry {
  request_id: string;
  content_hash: string;
}

interface OldTemplate {
  id: string;
  name: string;
  prompt: string;
  negative_prompt: string;
  default_params: {
    size?: string | null;
    n?: number | null;
    quality?: string | null;
    model?: string;
  };
  created_at: number;
  updated_at: number;
}

// ========== 统计 ==========

interface Stats {
  projects: number;
  projectsSkipped: number;
  categories: number;
  conversations: number;
  requests: number;
  batches: number;
  images: number;
  references: number;
  trashRecords: number;
  idempotency: number;
  templates: number;
  templatesSkipped: number;
  filesCopied: number;
  filesMissing: number;
  warnings: number;
}

const stats: Stats = {
  projects: 0,
  projectsSkipped: 0,
  categories: 0,
  conversations: 0,
  requests: 0,
  batches: 0,
  images: 0,
  references: 0,
  trashRecords: 0,
  idempotency: 0,
  templates: 0,
  templatesSkipped: 0,
  filesCopied: 0,
  filesMissing: 0,
  warnings: 0,
};

function warn(msg: string) {
  stats.warnings++;
  console.warn(`  [警告] ${msg}`);
}

// ========== 工具 ==========

function bool(v: unknown, fallback = false): number {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v !== 0 ? 1 : 0;
  return fallback ? 1 : 0;
}

function intOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : fallback;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function nullableStr(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function jsonArr(v: unknown): string {
  return JSON.stringify(Array.isArray(v) ? v : []);
}

function jsonObj(v: unknown): string {
  return v && typeof v === "object" ? JSON.stringify(v) : "{}";
}

/** 复制单个文件；源缺失返回 false */
function copyFile(src: string, dest: string): boolean {
  try {
    if (!fs.existsSync(src)) return false;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    return true;
  } catch (err) {
    warn(`复制文件失败: ${src} → ${dest} (${(err as Error).message})`);
    return false;
  }
}

/**
 * 复制项目二进制目录到新位置。
 * 旧布局: <source>/projects/<pid>/outputs|thumbnails|references/<file>
 * 新布局: <root>/public/outputs/<pid>/outputs|thumbnails|references/<file>  （相对路径保持不变）
 * 注意 references/ 里只复制二进制（跳过 *.json 实体文件）。
 */
function copyProjectFiles(sourceProjectDir: string, projectId: string, outputsRoot: string) {
  const targetBase = path.join(outputsRoot, projectId);

  for (const sub of ["outputs", "thumbnails", "references"] as const) {
    const srcDir = path.join(sourceProjectDir, sub);
    if (!fs.existsSync(srcDir)) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(srcDir, { withFileTypes: true });
    } catch (err) {
      warn(`读取目录失败: ${srcDir} (${(err as Error).message})`);
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      // references/ 目录下旧版同目录存放 ref 实体 JSON + 二进制；JSON 不复制
      if (sub === "references" && entry.name.endsWith(".json")) continue;
      const copied = copyFile(
        path.join(srcDir, entry.name),
        path.join(targetBase, sub, entry.name)
      );
      if (copied) stats.filesCopied++;
      else stats.filesMissing++;
    }
  }
}

// ========== 插入语句生成（列名即 snake_case，值按新 schema 约束规范化） ==========

type Row = { sql: string; args: InArgs };

function insertRow(table: string, columns: string[], args: InArgs): Row {
  const placeholders = columns.map(() => "?").join(", ");
  return {
    sql: `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`,
    args,
  };
}

function projectRow(p: OldProject): Row {
  return insertRow(
    "projects",
    ["id", "name", "type", "description", "archived", "hidden", "created_at", "updated_at"],
    [
      p.id,
      str(p.name, "未命名项目"),
      str(p.type, "free_creation"),
      str(p.description, ""),
      bool(p.archived),
      bool(p.hidden),
      intOr(p.created_at, Date.now()),
      intOr(p.updated_at, Date.now()),
    ]
  );
}

function categoryRow(c: OldCategory): Row {
  return insertRow(
    "categories",
    ["id", "project_id", "name", "sort_order", "created_at", "updated_at"],
    [
      c.id,
      c.project_id,
      str(c.name, "未分类"),
      intOr(c.sort_order, 0),
      intOr(c.created_at, Date.now()),
      intOr(c.updated_at, Date.now()),
    ]
  );
}

function conversationRow(c: OldConversation): Row {
  return insertRow(
    "conversations",
    [
      "id", "project_id", "category_id", "title", "is_initial", "title_custom",
      "created_at", "updated_at", "is_deleted", "deleted_at",
    ],
    [
      c.id,
      c.project_id,
      nullableStr(c.category_id),
      str(c.title, "新对话"),
      bool(c.is_initial),
      bool(c.title_custom),
      intOr(c.created_at, Date.now()),
      intOr(c.updated_at, Date.now()),
      bool(c.is_deleted),
      c.deleted_at == null ? null : intOr(c.deleted_at, 0),
    ]
  );
}

function requestRow(r: OldRequest): Row {
  return insertRow(
    "requests",
    [
      "id", "batch_id", "project_id", "category_id", "conversation_id",
      "prompt_original", "prompt_effective", "negative_prompt_original", "negative_prompt_effective",
      "negative_prompt_supported", "reference_asset_ids", "parameters", "request_snapshot",
      "idempotency_key", "status", "error_message", "unknown_reason",
      "retry_of_request_id", "completion_for_batch_id",
      "created_at", "started_at", "ended_at", "is_deleted", "deleted_at",
    ],
    [
      r.id,
      str(r.batch_id, ""),
      r.project_id,
      nullableStr(r.category_id),
      r.conversation_id,
      str(r.prompt_original, ""),
      str(r.prompt_effective, r.prompt_original ?? ""),
      nullableStr(r.negative_prompt_original),
      nullableStr(r.negative_prompt_effective),
      bool(r.negative_prompt_supported),
      jsonArr(r.reference_asset_ids),
      jsonObj(r.parameters),
      jsonObj(r.request_snapshot),
      str(r.idempotency_key, ""),
      normalizeStatus(r.status),
      nullableStr(r.error_message),
      nullableStr(r.unknown_reason),
      nullableStr(r.retry_of_request_id),
      nullableStr(r.completion_for_batch_id),
      intOr(r.created_at, Date.now()),
      r.started_at == null ? null : intOr(r.started_at, 0),
      r.ended_at == null ? null : intOr(r.ended_at, 0),
      bool(r.is_deleted),
      r.deleted_at == null ? null : intOr(r.deleted_at, 0),
    ]
  );
}

const VALID_STATUSES = new Set(["generating", "success", "failed", "unknown"]);
function normalizeStatus(s: unknown): string {
  return typeof s === "string" && VALID_STATUSES.has(s) ? s : "unknown";
}

function batchRow(b: OldBatch): Row {
  return insertRow(
    "batches",
    [
      "id", "request_id", "project_id", "category_id", "conversation_id",
      "target_count", "returned_count", "saved_count", "status",
      "is_completion", "original_failed_batch_id", "is_completed",
      "completion_request_ids", "image_asset_ids", "error_details",
      "created_at", "started_at", "ended_at",
    ],
    [
      b.id,
      b.request_id,
      b.project_id,
      nullableStr(b.category_id),
      b.conversation_id,
      intOr(b.target_count, 1),
      intOr(b.returned_count, 0),
      intOr(b.saved_count, 0),
      normalizeStatus(b.status),
      bool(b.is_completion),
      nullableStr(b.original_failed_batch_id),
      bool(b.is_completed),
      jsonArr(b.completion_request_ids),
      jsonArr(b.image_asset_ids),
      Array.isArray(b.error_details) ? JSON.stringify(b.error_details) : "[]",
      intOr(b.created_at, Date.now()),
      b.started_at == null ? null : intOr(b.started_at, 0),
      b.ended_at == null ? null : intOr(b.ended_at, 0),
    ]
  );
}

function imageAssetRow(a: OldImageAsset): Row {
  return insertRow(
    "image_assets",
    [
      "id", "project_id", "category_id", "conversation_id", "request_id", "batch_id",
      "file_path", "thumbnail_path", "thumbnail_status", "mimetype", "file_size",
      "source_image_ids", "batch_sibling_ids",
      "is_from_failed_batch", "is_reference_asset", "is_favorited",
      "user_note", "tags", "file_missing",
      "created_at", "updated_at", "is_deleted", "deleted_at",
    ],
    [
      a.id,
      a.project_id,
      nullableStr(a.category_id),
      a.conversation_id,
      nullableStr(a.request_id),
      nullableStr(a.batch_id),
      str(a.file_path, ""),
      nullableStr(a.thumbnail_path),
      normalizeThumbStatus(a.thumbnail_status),
      str(a.mimetype, "image/png"),
      intOr(a.file_size, 0),
      jsonArr(a.source_image_ids),
      jsonArr(a.batch_sibling_ids),
      bool(a.is_from_failed_batch),
      bool(a.is_reference_asset),
      bool(a.is_favorited),
      str(a.user_note, ""),
      jsonArr(a.tags),
      bool(a.file_missing),
      intOr(a.created_at, Date.now()),
      intOr(a.updated_at, Date.now()),
      bool(a.is_deleted),
      a.deleted_at == null ? null : intOr(a.deleted_at, 0),
    ]
  );
}

const VALID_THUMB = new Set(["pending", "ready", "failed"]);
function normalizeThumbStatus(s: unknown): string {
  return typeof s === "string" && VALID_THUMB.has(s) ? s : "pending";
}

function referenceAssetRow(r: OldReferenceAsset): Row {
  return insertRow(
    "reference_assets",
    [
      "id", "project_id", "type", "image_asset_id", "file_path",
      "original_filename", "name", "mimetype", "file_size",
      "user_note", "tags", "is_favorited",
      "created_at", "updated_at", "is_deleted", "deleted_at", "file_missing",
    ],
    [
      r.id,
      r.project_id,
      str(r.type, "uploaded"),
      nullableStr(r.image_asset_id),
      str(r.file_path, ""),
      str(r.original_filename, ""),
      str(r.name, "未命名参考图"),
      str(r.mimetype, "image/png"),
      intOr(r.file_size, 0),
      str(r.user_note, ""),
      jsonArr(r.tags),
      bool(r.is_favorited),
      intOr(r.created_at, Date.now()),
      intOr(r.updated_at, Date.now()),
      bool(r.is_deleted),
      r.deleted_at == null ? null : intOr(r.deleted_at, 0),
      bool(r.file_missing),
    ]
  );
}

function trashRow(t: OldTrashRecord): Row {
  return insertRow(
    "trash_records",
    ["id", "entity_type", "entity_id", "project_id", "deleted_at", "original_location", "cascade_ids"],
    [
      t.id,
      t.entity_type,
      t.entity_id,
      t.project_id,
      intOr(t.deleted_at, Date.now()),
      t.original_location && typeof t.original_location === "object"
        ? JSON.stringify(t.original_location)
        : "{}",
      t.cascade_ids && typeof t.cascade_ids === "object" ? JSON.stringify(t.cascade_ids) : "{}",
    ]
  );
}

function idempotencyRows(projectId: string, entries: Record<string, OldIdempotencyEntry>): Row[] {
  const rows: Row[] = [];
  for (const [key, entry] of Object.entries(entries)) {
    if (!entry || typeof entry !== "object" || !entry.request_id) continue;
    rows.push(
      insertRow(
        "idempotency",
        ["project_id", "client_request_id", "request_id", "content_hash", "created_at"],
        [
          projectId,
          key,
          entry.request_id,
          str(entry.content_hash, ""),
          intOr((entry as { created_at?: number }).created_at, Date.now()),
        ]
      )
    );
  }
  return rows;
}

// ========== 模板迁移 ==========

async function migrateTemplates(client: Client, sourceRoot: string) {
  const templatesFile = path.join(sourceRoot, "templates.json");
  if (!fs.existsSync(templatesFile)) {
    console.log("未找到 templates.json，跳过模板迁移");
    return;
  }

  const templates = readJsonFile<OldTemplate[]>(templatesFile, "templates.json");
  if (!Array.isArray(templates)) return;

  for (const t of templates) {
    if (!t || typeof t.name !== "string" || typeof t.prompt !== "string") {
      warn(`模板格式异常，跳过: ${JSON.stringify(t?.name ?? t)}`);
      continue;
    }

    // 幂等：按 name + prompt 查重
    const dup = await client.execute({
      sql: "SELECT id FROM templates WHERE name = ? AND prompt = ?",
      args: [t.name, t.prompt],
    });
    if (dup.rows.length > 0) {
      stats.templatesSkipped++;
      continue;
    }

    const params = t.default_params ?? {};
    const model = str(params.model, "gpt-image-2");
    const size = params.size ?? "1024x1024";
    const quality = params.quality ?? "";
    const n = params.n ?? 1;

    await client.execute({
      sql: "INSERT INTO templates (name, prompt, negative_prompt, model, size, quality, n, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      args: [
        t.name,
        t.prompt,
        str(t.negative_prompt, ""),
        model,
        size,
        quality,
        intOr(n, 1),
        intOr(t.created_at, Date.now()),
        intOr(t.updated_at, Date.now()),
      ],
    });
    stats.templates++;
  }
}

// ========== 单项目迁移 ==========

async function migrateProject(client: Client, projectDir: string, outputsRoot: string) {
  const projectId = path.basename(projectDir);

  // project.json 必须存在且可解析
  const projectFile = path.join(projectDir, "project.json");
  if (!fs.existsSync(projectFile)) {
    warn(`项目缺少 project.json，跳过: ${projectDir}`);
    return false;
  }
  const project = readJsonFile<OldProject>(projectFile, `project.json (${projectId})`);
  if (!project || typeof project.id !== "string" || !project.id) {
    return false; // readJsonFile 已警告
  }

  // 幂等：项目已存在则整体跳过
  const existing = await client.execute({
    sql: "SELECT id FROM projects WHERE id = ?",
    args: [project.id],
  });
  if (existing.rows.length > 0) {
    console.log(`跳过已导入的项目: ${project.name} (${project.id})`);
    stats.projectsSkipped++;
    return true;
  }

  console.log(`导入项目: ${project.name} (${project.id})`);

  const rows: Row[] = [projectRow(project)];

  // --- categories ---
  const categoriesFile = path.join(projectDir, "categories.json");
  if (fs.existsSync(categoriesFile)) {
    const cats = readJsonFile<OldCategory[]>(categoriesFile, `categories.json (${projectId})`);
    if (Array.isArray(cats)) {
      for (const c of cats) {
        if (!c?.id || c.project_id !== project.id) continue;
        rows.push(categoryRow(c));
        stats.categories++;
      }
    }
  }

  // --- conversations ---
  for (const file of listJsonFiles(path.join(projectDir, "conversations"))) {
    const conv = readJsonFile<OldConversation>(file, "conversation");
    if (!conv?.id || conv.project_id !== project.id) continue;
    rows.push(conversationRow(conv));
    stats.conversations++;
  }

  // --- requests ---
  for (const file of listJsonFiles(path.join(projectDir, "requests"))) {
    const req = readJsonFile<OldRequest>(file, "request");
    if (!req?.id || req.project_id !== project.id) continue;
    rows.push(requestRow(req));
    stats.requests++;
  }

  // --- batches ---
  for (const file of listJsonFiles(path.join(projectDir, "batches"))) {
    const batch = readJsonFile<OldBatch>(file, "batch");
    if (!batch?.id || batch.project_id !== project.id) continue;
    rows.push(batchRow(batch));
    stats.batches++;
  }

  // --- image assets ---
  for (const file of listJsonFiles(path.join(projectDir, "assets"))) {
    const asset = readJsonFile<OldImageAsset>(file, "image asset");
    if (!asset?.id || asset.project_id !== project.id) continue;
    rows.push(imageAssetRow(asset));
    stats.images++;
  }

  // --- reference assets ---
  for (const file of listJsonFiles(path.join(projectDir, "references"))) {
    const ref = readJsonFile<OldReferenceAsset>(file, "reference asset");
    if (!ref?.id || ref.project_id !== project.id) continue;
    rows.push(referenceAssetRow(ref));
    stats.references++;
  }

  // --- trash ---
  for (const file of listJsonFiles(path.join(projectDir, "trash"))) {
    const rec = readJsonFile<OldTrashRecord>(file, "trash record");
    if (!rec?.id || rec.project_id !== project.id) continue;
    rows.push(trashRow(rec));
    stats.trashRecords++;
  }

  // --- idempotency ---
  const idemFile = path.join(projectDir, "idempotency.json");
  if (fs.existsSync(idemFile)) {
    const idem = readJsonFile<Record<string, OldIdempotencyEntry>>(idemFile, `idempotency.json (${projectId})`);
    if (idem && typeof idem === "object") {
      const idemRows = idempotencyRows(project.id, idem);
      rows.push(...idemRows);
      stats.idempotency += idemRows.length;
    }
  }

  // 批量插入（单事务）
  await client.batch(
    rows.map((r) => ({ sql: r.sql, args: r.args })),
    "write"
  );
  stats.projects++;

  // --- 文件复制（DB 提交后再复制，失败不影响数据完整性） ---
  copyProjectFiles(projectDir, project.id, outputsRoot);

  return true;
}

// ========== 主流程 ==========

async function main() {
  const { source, db } = parseArgs();

  console.log("=== gpt-image-2-ui 数据迁移 ===");
  console.log(`源目录:   ${source}`);
  console.log(`目标数据库: ${db}`);
  console.log();

  // 源目录检查
  if (!fs.existsSync(source)) {
    console.error(`[错误] 源目录不存在: ${source}`);
    console.error("用法: npx tsx data-migration/migrate.ts --source <旧项目根目录>");
    process.exit(1);
  }
  const projectsRoot = path.join(source, "projects");
  if (!fs.existsSync(projectsRoot)) {
    console.error(`[错误] 源目录下未找到 projects/ 子目录: ${projectsRoot}`);
    process.exit(1);
  }

  // 数据库文件检查（要求先 drizzle-kit push 建表）
  if (!fs.existsSync(db)) {
    console.error(`[错误] 数据库文件不存在: ${db}`);
    console.error("请先运行: npx drizzle-kit push");
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(db), { recursive: true });

  const client = createClient({ url: `file:${db}` });

  // 输出目录（与 .env.local 的 OUTPUTS_DIR 对齐，默认 public/outputs）
  const outputsDirRel = readEnvLocal(process.cwd(), "OUTPUTS_DIR") || "public/outputs";
  const outputsRoot = path.resolve(process.cwd(), outputsDirRel);

  // 扫描项目目录
  let projectDirs: string[] = [];
  try {
    projectDirs = fs
      .readdirSync(projectsRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith("proj_"))
      .map((e) => path.join(projectsRoot, e.name))
      .sort();
  } catch (err) {
    console.error(`[错误] 读取项目目录失败: ${(err as Error).message}`);
    process.exit(1);
  }

  if (projectDirs.length === 0) {
    console.log("源目录中没有找到任何项目（projects/proj_*/），无需迁移。");
  } else {
    for (const dir of projectDirs) {
      try {
        await migrateProject(client, dir, outputsRoot);
      } catch (err) {
        warn(`项目导入失败: ${path.basename(dir)} (${(err as Error).message})`);
      }
    }
  }

  console.log();
  console.log("--- 模板迁移 ---");
  await migrateTemplates(client, source);

  client.close();

  // 统计输出
  console.log();
  console.log("=== 迁移完成，统计 ===");
  console.log(`项目:         ${stats.projects} 导入 / ${stats.projectsSkipped} 跳过（已存在）`);
  console.log(`分类:         ${stats.categories}`);
  console.log(`对话:         ${stats.conversations}`);
  console.log(`请求:         ${stats.requests}`);
  console.log(`批次:         ${stats.batches}`);
  console.log(`生成图片:     ${stats.images}`);
  console.log(`参考图:       ${stats.references}`);
  console.log(`回收站记录:   ${stats.trashRecords}`);
  console.log(`幂等键:       ${stats.idempotency}`);
  console.log(`模板:         ${stats.templates} 导入 / ${stats.templatesSkipped} 跳过（重复）`);
  console.log(`复制文件:     ${stats.filesCopied} 成功 / ${stats.filesMissing} 源缺失`);
  if (stats.warnings > 0) {
    console.log(`警告:         ${stats.warnings} 条（见上方 [警告] 输出）`);
  }
}

main().catch((err) => {
  console.error("[错误] 迁移失败:", err);
  process.exit(1);
});
