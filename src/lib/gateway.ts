import crypto from "crypto";
import type { RequestSnapshot } from "@/types/entities";
import { nowMs } from "./id";

// Gateway error classes
export class GatewayError extends Error {
  constructor(
    message: string,
    public detail?: string
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

export class GatewayHTTPError extends GatewayError {
  constructor(
    public statusCode: number,
    message?: string,
    detail?: string
  ) {
    super(message || `网关 HTTP 错误: ${statusCode}`, detail);
    this.name = "GatewayHTTPError";
  }
}

export class GatewayResponseError extends GatewayError {
  constructor(message: string, detail?: string) {
    super(message, detail);
    this.name = "GatewayResponseError";
  }
}

export class GatewayTimeoutUnknown extends GatewayError {
  constructor(message: string, detail?: string) {
    super(message, detail);
    this.name = "GatewayTimeoutUnknown";
  }
}

// ========== Types ==========

export interface GenerateParams {
  apiKey: string;
  baseUrl?: string | null;
  model?: string | null;
  prompt: string;
  size: string;
  n: number;
  quality?: string | null;
  negativePrompt?: string | null;
  references?: Array<{
    filename: string;
    content: Buffer;
    mimetype: string;
  }> | null;
  timeout?: number;
}

export interface GenerateEntry {
  content: Buffer | null;
  suffix: string;
  originUrl: string | null;
  error: string | null;
}

// ========== Constants ==========

const GENERATIONS_PATH = "/v1/images/generations";
const EDITS_PATH = "/v1/images/edits";
const DEFAULT_SUFFIX = "png";
const DETAIL_LIMIT = 2000;
const URL_DOWNLOAD_TIMEOUT = 120_000; // ms
const GENERATION_TIMEOUT_DEFAULT = 300_000; // ms

const DOWNLOAD_MAX_ATTEMPTS = 3;
const DOWNLOAD_BACKOFF_BASE = 0.5; // seconds
const DOWNLOAD_RETRYABLE_HTTP = [429, 500, 502, 503, 504];

const GENERATION_MAX_ATTEMPTS = 3;
const GENERATION_BACKOFF_BASE = 1.0; // seconds
const GENERATION_CONNECT_TIMEOUT = 30_000; // ms
// 瞬时性 HTTP 错误（网关反代抖动/限流）重试；其余（401/400 等）确定性失败
const GENERATION_RETRYABLE_HTTP = [429, 500, 502, 503, 504];

const TLS_VERIFY = process.env.LIGHTWHEEL_TLS_VERIFY !== "false";

// ========== Main entry point ==========

export async function callGenerate(params: GenerateParams): Promise<GenerateEntry[]> {
  const {
    apiKey,
    baseUrl,
    model = "gpt-image-2",
    prompt,
    size,
    n,
    quality,
    negativePrompt,
    references,
    timeout = GENERATION_TIMEOUT_DEFAULT,
  } = params;

  // Mock mode
  if (baseUrl?.startsWith("mock")) {
    return mockGenerate(prompt, size, n);
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  };

  const payload: Record<string, unknown> = {
    model,
    prompt,
    n,
    size,
  };
  if (quality != null) payload["quality"] = quality;
  if (negativePrompt != null) payload["negative_prompt"] = negativePrompt;

  const url = `${baseUrl}${references ? EDITS_PATH : GENERATIONS_PATH}`;

  // Connection retry loop
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < GENERATION_MAX_ATTEMPTS; attempt++) {
    try {
      let resp: Response;

      if (references && references.length > 0) {
        // Edits: multipart
        const formData = new FormData();
        for (const [k, v] of Object.entries(payload)) {
          formData.append(k, String(v));
        }
        const fieldName = references.length === 1 ? "image" : "image[]";
        for (const ref of references) {
          formData.append(
            fieldName,
            new Blob([new Uint8Array(ref.content)], { type: ref.mimetype }),
            ref.filename
          );
        }

        resp = await fetch(url, {
          method: "POST",
          headers,
          body: formData,
          signal: AbortSignal.timeout(timeout + GENERATION_CONNECT_TIMEOUT),
        });
      } else {
        // Generations: JSON
        resp = await fetch(url, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeout + GENERATION_CONNECT_TIMEOUT),
        });
      }

      if (!resp.ok) {
        const text = (await resp.text().catch(() => "")).slice(0, DETAIL_LIMIT);
        throw new GatewayHTTPError(resp.status, undefined, text);
      }

      const body = await resp.json().catch(() => null);
      if (!body || typeof body !== "object") {
        throw new GatewayResponseError("响应不是合法 JSON");
      }

      const data = body["data"];
      if (!Array.isArray(data) || data.length === 0) {
        throw new GatewayResponseError(
          "响应中没有 data 条目",
          JSON.stringify(body).slice(0, DETAIL_LIMIT)
        );
      }

      return await Promise.all(
        data.map((item: unknown) => buildEntry(item, apiKey))
      );
    } catch (e) {
      // Classify: deterministic HTTP errors (401/400...) and response errors fail immediately
      if (
        e instanceof GatewayHTTPError &&
        !GENERATION_RETRYABLE_HTTP.includes(e.statusCode)
      ) {
        throw e;
      }
      if (e instanceof GatewayResponseError) {
        throw e; // Deterministic, don't retry
      }
      if (e instanceof GatewayTimeoutUnknown) {
        throw e;
      }
      // Retryable HTTP (502/503/429...), TypeError / network errors → retry
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (attempt < GENERATION_MAX_ATTEMPTS - 1) {
        await sleep(GENERATION_BACKOFF_BASE * Math.pow(2, attempt) * 1000);
      }
    }
  }

  // 重试耗尽：瞬时 HTTP 错误按原状态码抛出（明确 failed），
  // 仅连接层错误归为 unknown（网关可能已受理但响应丢失）
  if (lastErr instanceof GatewayHTTPError) {
    throw lastErr;
  }
  throw new GatewayTimeoutUnknown(
    `连接网关失败（已重试 ${GENERATION_MAX_ATTEMPTS} 次）：${lastErr?.message}`
  );
}

// ========== Entry builder ==========

async function buildEntry(
  item: unknown,
  apiKey?: string
): Promise<GenerateEntry> {
  if (!item || typeof item !== "object") {
    return {
      content: null,
      suffix: DEFAULT_SUFFIX,
      originUrl: null,
      error: "该结果不是有效对象",
    };
  }

  const obj = item as Record<string, unknown>;
  const b64 = obj["b64_json"];
  const imgUrl = obj["url"];

  if (b64 && typeof b64 === "string") {
    try {
      const raw = Buffer.from(b64, "base64");
      return { content: raw, suffix: DEFAULT_SUFFIX, originUrl: null, error: null };
    } catch (e) {
      return {
        content: null,
        suffix: DEFAULT_SUFFIX,
        originUrl: null,
        error: `b64_json 解码失败：${e}`,
      };
    }
  }

  if (imgUrl && typeof imgUrl === "string") {
    try {
      const raw = await downloadImage(imgUrl, apiKey);
      return {
        content: raw,
        suffix: suffixFromUrl(imgUrl),
        originUrl: imgUrl,
        error: null,
      };
    } catch (e) {
      return {
        content: null,
        suffix: DEFAULT_SUFFIX,
        originUrl: imgUrl,
        error: `图片下载失败：${e}`,
      };
    }
  }

  return {
    content: null,
    suffix: DEFAULT_SUFFIX,
    originUrl: null,
    error: "该结果既无 url 也无 b64_json",
  };
}

// ========== Image download ==========

async function downloadImage(
  url: string,
  apiKey?: string
): Promise<Buffer> {
  const plainHeaders: Record<string, string> = {
    "User-Agent": "Mozilla/5.0",
  };
  const authHeaders: Record<string, string> = { ...plainHeaders };
  if (apiKey) {
    authHeaders["Authorization"] = `Bearer ${apiKey}`;
  }

  let useAuth = false;
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt < DOWNLOAD_MAX_ATTEMPTS; attempt++) {
    const headers = useAuth ? authHeaders : plainHeaders;
    try {
      const resp = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(URL_DOWNLOAD_TIMEOUT),
      });

      if (!resp.ok) {
        // 401/403 with no auth → retry with auth
        if (!useAuth && (resp.status === 401 || resp.status === 403) && apiKey) {
          useAuth = true;
          lastErr = new Error(`HTTP ${resp.status}`);
          continue;
        }
        if (!DOWNLOAD_RETRYABLE_HTTP.includes(resp.status)) {
          throw new Error(`下载失败 HTTP ${resp.status}`);
        }
        lastErr = new Error(`HTTP ${resp.status}`);
      } else {
        const buf = await resp.arrayBuffer();
        return Buffer.from(buf);
      }
    } catch (e) {
      // TypeError = network error → retryable
      lastErr = e instanceof Error ? e : new Error(String(e));
    }

    if (attempt < DOWNLOAD_MAX_ATTEMPTS - 1) {
      await sleep(DOWNLOAD_BACKOFF_BASE * Math.pow(2, attempt) * 1000);
    }
  }

  throw lastErr ?? new Error("下载失败：未知错误");
}

// ========== Helpers ==========

function suffixFromUrl(url: string): string {
  const path = url.split("?")[0]!.split("#")[0]!;
  if (path.includes(".")) {
    const s = path.split(".").pop()!.toLowerCase();
    if (["png", "jpg", "jpeg", "webp", "gif"].includes(s)) return s;
  }
  return DEFAULT_SUFFIX;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ========== Mock gateway ==========

function mockGenerate(
  prompt: string,
  size: string,
  n: number
): GenerateEntry[] {
  if (prompt.includes("mock-fail")) {
    throw new GatewayHTTPError(500, undefined, "mock gateway 模拟的 HTTP 500");
  }
  if (prompt.includes("mock-timeout")) {
    throw new GatewayTimeoutUnknown("mock gateway 模拟的网络超时");
  }

  if (prompt.includes("mock-partial")) {
    if (n > 1) {
      return Array.from({ length: n - 1 }, (_, i) => mockEntry(size, i));
    }
    return [{ content: null, suffix: DEFAULT_SUFFIX, originUrl: null, error: "mock partial" }];
  }

  return Array.from({ length: n }, (_, i) => mockEntry(size, i));
}

function mockEntry(size: string, index: number): GenerateEntry {
  try {
    const [w, h] = parseSize(size);
    // Generate a simple colored PNG using raw pixel data
    const bg = [
      (200 + index * 37) % 256,
      (220 + index * 53) % 256,
      (240 + index * 29) % 256,
    ];
    const raw = mockRenderPng(w, h, bg, `${size} #${index + 1}`);
    return { content: raw, suffix: DEFAULT_SUFFIX, originUrl: null, error: null };
  } catch (e) {
    return { content: null, suffix: DEFAULT_SUFFIX, originUrl: null, error: `mock 图片生成失败：${e}` };
  }
}

function parseSize(size: string): [number, number] {
  try {
    const [wStr, hStr] = size.toLowerCase().split("x") as [string, string];
    const w = parseInt(wStr!, 10);
    const h = parseInt(hStr!, 10);
    if (w <= 0 || h <= 0) throw new Error("invalid");
    return [Math.min(w, 2048), Math.min(h, 2048)];
  } catch {
    return [1024, 1024];
  }
}

function mockRenderPng(
  w: number,
  h: number,
  bg: number[],
  text: string
): Buffer {
  // Minimal PNG generator without sharp: create a simple valid PNG with colored background
  // Using sharp would be cleaner, but for mock mode we keep it dependency-light
  // We write raw pixel data and encode as PNG using sharp
  // For now, return a minimal placeholder — in production, sharp is available
  const { generatePng } = require("./mock-png");
  return generatePng(w, h, bg, text);
}