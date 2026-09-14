import { NextRequest } from "next/server";
import { getConfig } from "@/lib/config";
import { ok } from "@/lib/errors";
import { errorResponse } from "@/lib/api-helpers";
import { ensureInit } from "@/lib/init";

export async function GET(_request: NextRequest) {
  try {
    await ensureInit();
    const config = getConfig();
    return ok({
      baseUrl: config.baseUrl,
      hasApiKey: false,
      model: config.model,
      capabilities: config.capabilities,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
