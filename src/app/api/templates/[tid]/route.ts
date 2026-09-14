import { NextRequest } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { ok, notFound } from "@/lib/errors";
import { errorResponse, readJsonBody } from "@/lib/api-helpers";
import { ensureInit } from "@/lib/init";
import { nowMs } from "@/lib/id";

/** PATCH /api/templates/[tid] — 更新模板 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tid: string }> }
) {
  try {
    await ensureInit();
    const { tid } = await params;
    const templateId = parseInt(tid, 10);
    if (!Number.isInteger(templateId)) throw notFound("模板不存在");

    const data = await readJsonBody(request);
    const rows = await db
      .select()
      .from(schema.templates)
      .where(eq(schema.templates.id, templateId))
      .limit(1);
    if (!rows[0]) throw notFound("模板不存在");

    const updates: Partial<typeof schema.templates.$inferInsert> = {};
    if ("name" in data) {
      if (typeof data.name !== "string" || !(data.name as string).trim()) {
        return Response.json(
          { success: false, error: "模板名称不能为空" },
          { status: 400 }
        );
      }
      updates.name = (data.name as string).trim();
    }
    if ("prompt" in data) {
      if (typeof data.prompt !== "string" || !(data.prompt as string).trim()) {
        return Response.json(
          { success: false, error: "提示词不能为空" },
          { status: 400 }
        );
      }
      updates.prompt = (data.prompt as string).trim();
    }
    if ("negative_prompt" in data) {
      if (typeof data.negative_prompt !== "string") {
        return Response.json(
          { success: false, error: "负面提示词必须是字符串" },
          { status: 400 }
        );
      }
      updates.negativePrompt = data.negative_prompt as string;
    }
    if ("model" in data && typeof data.model === "string") updates.model = data.model;
    if ("size" in data && typeof data.size === "string") updates.size = data.size;
    if ("quality" in data && typeof data.quality === "string") updates.quality = data.quality;
    if ("n" in data && typeof data.n === "number" && Number.isInteger(data.n)) {
      updates.n = data.n;
    }
    updates.updatedAt = nowMs();

    await db
      .update(schema.templates)
      .set(updates)
      .where(eq(schema.templates.id, templateId));

    const updated = await db
      .select()
      .from(schema.templates)
      .where(eq(schema.templates.id, templateId))
      .limit(1);
    const all = await db
      .select()
      .from(schema.templates)
      .orderBy(asc(schema.templates.createdAt));
    return ok({ template: updated[0], templates: all });
  } catch (e) {
    return errorResponse(e);
  }
}

/** DELETE /api/templates/[tid] — 删除模板 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ tid: string }> }
) {
  try {
    await ensureInit();
    const { tid } = await params;
    const templateId = parseInt(tid, 10);
    if (!Number.isInteger(templateId)) throw notFound("模板不存在");

    const rows = await db
      .select({ id: schema.templates.id })
      .from(schema.templates)
      .where(eq(schema.templates.id, templateId))
      .limit(1);
    if (!rows[0]) throw notFound("模板不存在");

    await db.delete(schema.templates).where(eq(schema.templates.id, templateId));
    return ok({ removed: 1 });
  } catch (e) {
    return errorResponse(e);
  }
}
