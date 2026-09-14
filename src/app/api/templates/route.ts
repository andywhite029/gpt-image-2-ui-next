import { NextRequest } from "next/server";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { ok } from "@/lib/errors";
import { errorResponse, readJsonBody } from "@/lib/api-helpers";
import { ensureInit } from "@/lib/init";
import { nowMs } from "@/lib/id";

/** GET /api/templates — 模板列表 */
export async function GET(_request: NextRequest) {
  try {
    await ensureInit();
    const rows = await db
      .select()
      .from(schema.templates)
      .orderBy(asc(schema.templates.createdAt));
    return ok({ templates: rows });
  } catch (e) {
    return errorResponse(e);
  }
}

/** POST /api/templates — 创建模板 */
export async function POST(request: NextRequest) {
  try {
    await ensureInit();
    const data = await readJsonBody(request);

    const name = typeof data.name === "string" ? data.name.trim() : "";
    const prompt = typeof data.prompt === "string" ? data.prompt.trim() : "";
    if (!name || !prompt) {
      return Response.json(
        { success: false, error: "模板名称和提示词都不能为空" },
        { status: 400 }
      );
    }

    const negativePrompt =
      typeof data.negative_prompt === "string" ? data.negative_prompt : "";
    const model = typeof data.model === "string" && data.model ? data.model : "gpt-image-2";
    const size = typeof data.size === "string" && data.size ? data.size : "1024x1024";
    const quality = typeof data.quality === "string" ? data.quality : "";
    const n = typeof data.n === "number" && Number.isInteger(data.n) ? data.n : 1;

    const ts = nowMs();
    const inserted = await db
      .insert(schema.templates)
      .values({
        name,
        prompt,
        negativePrompt,
        model,
        size,
        quality,
        n,
        createdAt: ts,
        updatedAt: ts,
      })
      .returning();

    const rows = await db
      .select()
      .from(schema.templates)
      .orderBy(asc(schema.templates.createdAt));
    return ok({ template: inserted[0], templates: rows }, 201);
  } catch (e) {
    return errorResponse(e);
  }
}
