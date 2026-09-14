export class ServiceError extends Error {
  constructor(
    message: string,
    public code: string = "INTERNAL_ERROR",
    public status: number = 500,
    public detail?: string,
    public traceableId?: string
  ) {
    super(message);
    this.name = "ServiceError";
  }

  toJSON() {
    return {
      success: false as const,
      error: this.message,
      code: this.code,
      detail: this.detail,
      traceable_id: this.traceableId,
    };
  }

  toResponse(init?: ResponseInit): Response {
    return Response.json(this.toJSON(), {
      status: this.status,
      ...init,
    });
  }
}

// Convenience constructors
export function badRequest(
  message: string,
  code = "VALIDATION_ERROR"
): ServiceError {
  return new ServiceError(message, code, 400);
}

export function validationError(message: string): ServiceError {
  return badRequest(message, "VALIDATION_ERROR");
}

export function notFound(
  message = "资源不存在",
  code = "NOT_FOUND"
): ServiceError {
  return new ServiceError(message, code, 404);
}

export function conflict(
  message: string,
  code = "CONFLICT",
  traceableId?: string
): ServiceError {
  return new ServiceError(message, code, 409, undefined, traceableId);
}

export function missingApiKey(): ServiceError {
  return badRequest(
    "生成需要提供 API Key，请先在设置中填写",
    "MISSING_API_KEY"
  );
}

// Success response helper
export function ok<T>(data: T, status = 200): Response {
  return Response.json({ success: true, ...data }, { status });
}