// fetch 封装：解析 {success, ...} 响应格式
// 所有响应：{success: true, ...data} 或 {success: false, error, code, detail, traceable_id}

export interface ApiError {
  message: string;
  code: string | null;
  status: number;
  detail: unknown;
  traceable_id: string | null;
}

export function isApiError(e: unknown): e is ApiError {
  return (
    typeof e === "object" &&
    e !== null &&
    "message" in e &&
    "status" in e
  );
}

export function buildQuery(params?: Record<string, string | number | boolean | null | undefined>): string {
  if (!params) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(value)));
  }
  return parts.length ? "?" + parts.join("&") : "";
}

interface RequestOptions {
  method?: string;
  body?: BodyInit;
  headers?: Record<string, string>;
}

/**
 * 发起 API 请求。成功返回完整 data（含 success 与其余字段）。
 * 失败抛 ApiError {message, code, status, detail, traceable_id}。
 */
export async function api<T = Record<string, unknown>>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { method = "GET", body, headers = {} } = options;
  let resp: Response;
  try {
    resp = await fetch(path, { method, headers, body });
  } catch (e) {
    throw {
      message: "网络请求失败：" + (e instanceof Error ? e.message : String(e)),
      code: "NETWORK_ERROR",
      status: 0,
      detail: null,
      traceable_id: null,
    } satisfies ApiError;
  }

  let data: unknown = null;
  const text = await resp.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  const fromBody =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};

  if (!resp.ok || fromBody.success === false) {
    throw {
      message:
        (typeof fromBody.error === "string" && fromBody.error) ||
        (fromBody.message ? String(fromBody.message) : `请求失败（HTTP ${resp.status}）`),
      code: (fromBody.code as string) ?? null,
      status: resp.status,
      detail: fromBody.detail ?? null,
      traceable_id: (fromBody.traceable_id as string) ?? null,
    } satisfies ApiError;
  }

  return data as T;
}

/** JSON body 快捷参数 */
export function jsonBody(data: unknown): RequestOptions {
  return {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data ?? {}),
  };
}

/** 把 ApiError 格式化为可展示文本 */
export function errorText(e: unknown): string {
  if (!e) return "未知错误";
  if (!isApiError(e)) {
    return e instanceof Error ? e.message : String(e);
  }
  let text = e.message || "未知错误";
  if (e.detail !== undefined && e.detail !== null && e.detail !== "") {
    const detail = typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail);
    text += "\n" + detail;
  }
  if (e.traceable_id) text += `\n追踪 ID：${e.traceable_id}`;
  return text;
}

/** 复制文本到剪贴板（含 execCommand 回退），返回是否成功 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.top = "0";
      ta.style.left = "0";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

// ============================================================================
// 类型化的端点封装
// ============================================================================

import type {
  Batch,
  Category,
  Conversation,
  ConversationRound,
  ImageSummary,
  Project,
  ProjectOverview,
  ReferenceSummary,
  Request,
  RequestSnapshot,
  SearchResult,
  Template,
  TrashItem,
} from "@/types/entities";

export interface ProjectWithCounts extends Project {
  counts?: { conversations: number; images: number; references?: number };
}

export interface ConfigResponse {
  success: boolean;
  baseUrl: string;
  hasApiKey: boolean;
  model: string;
  capabilities: Record<
    string,
    {
      supported_sizes: Array<{ size: string; ratio: string }>;
      supports_quality: boolean;
      quality_options: string[];
      supports_negative_prompt: boolean;
      max_reference_images: number;
    }
  >;
}

export interface ImageListResponse {
  success: boolean;
  items: ImageSummary[];
  total?: number;
}

export interface GeneratePayload {
  api_key: string;
  prompt: string;
  negative_prompt?: string | null;
  size: string;
  n: number;
  quality?: string | null;
  model?: string;
  base_url?: string;
  reference_ids?: string[];
  category_id?: string | null;
  client_request_id?: string;
}

export interface GenerateResponse {
  success: boolean;
  request: Request;
  batch: Batch;
}

export interface BatchResponse {
  success: boolean;
  batch: Batch;
  request: Request;
  images: ImageSummary[];
}

export interface ImageDetailResponse {
  success: boolean;
  image: ImageSummary;
  request?: Request | null;
  category_name?: string | null;
  conversation_title?: string | null;
  reference_assets?: ReferenceSummary[];
  source_images?: ImageSummary[];
  batch_siblings?: ImageSummary[];
}

export type { ImageSummary, ReferenceSummary };

export const endpoints = {
  // ---- 配置 ----
  config: () => api<ConfigResponse>("/api/config"),

  // ---- 项目 ----
  projects: (includeHidden = true) =>
    api<{ success: boolean; projects: ProjectWithCounts[] }>(
      "/api/projects" + buildQuery({ include_hidden: includeHidden ? 1 : undefined })
    ),
  createProject: (d: { name: string; type: string; description?: string }) =>
    api<{ success: boolean; project: Project }>("/api/projects", { method: "POST", ...jsonBody(d) }),
  project: (pid: string) =>
    api<ProjectOverview & { success: boolean }>(`/api/projects/${encodeURIComponent(pid)}`),
  patchProject: (pid: string, d: Partial<Pick<Project, "name" | "description" | "archived" | "hidden">>) =>
    api<{ success: boolean; project: Project }>(`/api/projects/${encodeURIComponent(pid)}`, {
      method: "PATCH",
      ...jsonBody(d),
    }),
  deleteProject: (pid: string) =>
    api<{ success: boolean }>(`/api/projects/${encodeURIComponent(pid)}`, { method: "DELETE" }),

  // ---- 分类 ----
  categories: (pid: string) =>
    api<{ success: boolean; categories: Category[] }>(`/api/projects/${encodeURIComponent(pid)}/categories`),
  createCategory: (pid: string, d: { name: string }) =>
    api<{ success: boolean; category: Category }>(`/api/projects/${encodeURIComponent(pid)}/categories`, {
      method: "POST",
      ...jsonBody(d),
    }),
  patchCategory: (cid: string, d: { name?: string }) =>
    api<{ success: boolean; category: Category }>(`/api/categories/${encodeURIComponent(cid)}`, {
      method: "PATCH",
      ...jsonBody(d),
    }),
  deleteCategory: (pid: string, cid: string) =>
    api<{ success: boolean; moved_conversations?: number; moved_images?: number }>(
      `/api/categories/${encodeURIComponent(cid)}`,
      { method: "DELETE" }
    ),
  reorderCategories: (pid: string, orderedIds: string[]) =>
    api<{ success: boolean }>(`/api/projects/${encodeURIComponent(pid)}/categories/reorder`, {
      method: "POST",
      ...jsonBody({ ordered_ids: orderedIds }),
    }),

  // ---- 对话 ----
  conversations: (pid: string, categoryId?: string) =>
    api<{ success: boolean; conversations: Conversation[] }>(
      `/api/projects/${encodeURIComponent(pid)}/conversations` +
        buildQuery({ category_id: categoryId })
    ),
  createConversation: (pid: string, d: { title?: string; category_id?: string | null }) =>
    api<{ success: boolean; conversation: Conversation }>(
      `/api/projects/${encodeURIComponent(pid)}/conversations`,
      { method: "POST", ...jsonBody(d) }
    ),
  conversation: (cid: string) =>
    api<{ success: boolean; conversation: Conversation; rounds: ConversationRound[] }>(
      `/api/conversations/${encodeURIComponent(cid)}`
    ),
  patchConversation: (cid: string, d: { title?: string; category_id?: string | null }) =>
    api<{ success: boolean; conversation: Conversation }>(`/api/conversations/${encodeURIComponent(cid)}`, {
      method: "PATCH",
      ...jsonBody(d),
    }),
  deleteConversation: (cid: string) =>
    api<{ success: boolean }>(`/api/conversations/${encodeURIComponent(cid)}`, { method: "DELETE" }),
  moveConversation: (cid: string, d: { project_id: string; category_id?: string | null }) =>
    api<{ success: boolean; conversation: Conversation; moved: boolean }>(
      `/api/conversations/${encodeURIComponent(cid)}/move`,
      { method: "POST", ...jsonBody(d) }
    ),

  // ---- 生成 ----
  generate: (pid: string, cid: string, payload: GeneratePayload) =>
    api<GenerateResponse>(
      `/api/projects/${encodeURIComponent(pid)}/conversations/${encodeURIComponent(cid)}/generate`,
      { method: "POST", ...jsonBody(payload) }
    ),
  request: (rid: string) =>
    api<{ success: boolean; request: Request; batch: Batch }>(`/api/requests/${encodeURIComponent(rid)}`),
  retry: (rid: string, payload: { api_key: string; base_url?: string; model?: string }) =>
    api<GenerateResponse>(`/api/requests/${encodeURIComponent(rid)}/retry`, {
      method: "POST",
      ...jsonBody(payload),
    }),
  editRetry: (rid: string) =>
    api<{ success: boolean } & RequestSnapshot>(`/api/requests/${encodeURIComponent(rid)}/edit-retry`, {
      method: "POST",
      ...jsonBody({}),
    }),
  batch: (bid: string) => api<BatchResponse>(`/api/batches/${encodeURIComponent(bid)}`),
  complete: (bid: string, payload: { api_key: string; base_url?: string; model?: string }) =>
    api<GenerateResponse>(`/api/batches/${encodeURIComponent(bid)}/complete`, {
      method: "POST",
      ...jsonBody(payload),
    }),

  // ---- 图片 ----
  images: (pid: string, filters?: Record<string, string | number | boolean | null | undefined>) =>
    api<ImageListResponse>(`/api/projects/${encodeURIComponent(pid)}/images` + buildQuery(filters)),
  image: (iid: string) => api<ImageDetailResponse>(`/api/images/${encodeURIComponent(iid)}`),
  patchImage: (
    iid: string,
    d: { is_favorited?: boolean; user_note?: string; tags?: string[]; category_id?: string | null }
  ) =>
    api<{ success: boolean }>(`/api/images/${encodeURIComponent(iid)}`, { method: "PATCH", ...jsonBody(d) }),
  deleteImage: (iid: string) =>
    api<{ success: boolean }>(`/api/images/${encodeURIComponent(iid)}`, { method: "DELETE" }),
  addToReferenceLibrary: (iid: string) =>
    api<{ success: boolean }>(`/api/images/${encodeURIComponent(iid)}/add-to-reference-library`, {
      method: "POST",
      ...jsonBody({}),
    }),

  // ---- 参考图 ----
  references: (pid: string) =>
    api<{ success: boolean; references: ReferenceSummary[] }>(
      `/api/projects/${encodeURIComponent(pid)}/references`
    ),
  uploadReferences: (pid: string, files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append("image", f));
    return api<{ success: boolean; references: ReferenceSummary[] }>(
      `/api/projects/${encodeURIComponent(pid)}/references`,
      { method: "POST", body: form }
    );
  },
  patchReference: (
    rid: string,
    d: { name?: string; user_note?: string; tags?: string[]; is_favorited?: boolean }
  ) =>
    api<{ success: boolean }>(`/api/references/${encodeURIComponent(rid)}`, { method: "PATCH", ...jsonBody(d) }),
  deleteReference: (rid: string) =>
    api<{ success: boolean }>(`/api/references/${encodeURIComponent(rid)}`, { method: "DELETE" }),

  // ---- 回收站 ----
  trash: () => api<{ success: boolean; items: TrashItem[] }>("/api/trash"),
  restore: (type: string, eid: string) =>
    api<{ success: boolean }>(`/api/trash/${encodeURIComponent(type)}/${encodeURIComponent(eid)}/restore`, {
      method: "POST",
      ...jsonBody({}),
    }),
  purgeTrash: (type: string, eid: string, force = false) =>
    api<{ success: boolean; force?: boolean }>(
      `/api/trash/${encodeURIComponent(type)}/${encodeURIComponent(eid)}` +
        (force ? "?force=1" : ""),
      { method: "DELETE" }
    ),
  emptyTrash: () => api<{ success: boolean; purged?: number; failed?: unknown[] }>("/api/trash", { method: "DELETE" }),

  // ---- 搜索 ----
  search: (params: {
    q?: string;
    project_id?: string;
    favorites?: boolean;
    reference_library?: boolean;
    uncategorized?: boolean;
    sort?: string;
  }) => api<{ success: boolean; results: SearchResult[] }>("/api/search" + buildQuery(params)),

  // ---- 模板 ----
  templates: () => api<{ success: boolean; templates: Template[] }>("/api/templates"),
  createTemplate: (d: {
    name: string;
    prompt: string;
    negative_prompt?: string;
    size?: string;
    quality?: string;
    n?: number;
  }) => api<{ success: boolean; template: Template }>("/api/templates", { method: "POST", ...jsonBody(d) }),
  patchTemplate: (
    tid: number,
    d: Partial<{ name: string; prompt: string; negative_prompt: string; size: string; quality: string; n: number }>
  ) =>
    api<{ success: boolean }>(`/api/templates/${encodeURIComponent(tid)}`, { method: "PATCH", ...jsonBody(d) }),
  deleteTemplate: (tid: number) =>
    api<{ success: boolean }>(`/api/templates/${encodeURIComponent(tid)}`, { method: "DELETE" }),
};

/** 图片二进制 URL（同源） */
export const imageUrl = {
  file: (iid: string) => `/api/images/${encodeURIComponent(iid)}/file`,
  thumbnail: (iid: string) => `/api/images/${encodeURIComponent(iid)}/thumbnail`,
  preview: (iid: string) => `/api/images/${encodeURIComponent(iid)}/preview`,
};

export function imageThumbUrl(img: Pick<ImageSummary, "id" | "thumbnailUrl" | "thumbnailStatus">): string {
  if (img.thumbnailStatus === "ready") return imageUrl.thumbnail(img.id);
  return imageUrl.file(img.id);
}

export function referenceFileUrl(rid: string): string {
  return `/api/references/${encodeURIComponent(rid)}/file`;
}
