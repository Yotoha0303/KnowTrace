export class AppError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }
}

export function toPublicError(error: unknown): {
  code: string;
  message: string;
} {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message };
  }

  console.error(error);
  return {
    code: "INTERNAL_ERROR",
    message: "操作失败，请稍后重试。",
  };
}
