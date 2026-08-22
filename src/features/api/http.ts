import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError } from "@/shared/errors/app-error";

export const API_VERSION = "v1";

type ApiMeta = Record<string, unknown>;

function requestId(request: Request): string {
  const supplied = request.headers.get("x-request-id")?.trim();
  return supplied && supplied.length >= 8 && supplied.length <= 128
    ? supplied
    : crypto.randomUUID();
}

function responseHeaders(id: string, headers?: HeadersInit): Headers {
  const output = new Headers(headers);
  output.set("Cache-Control", "private, no-store");
  output.set("X-Request-Id", id);
  return output;
}

export function apiSuccess<T>(
  request: Request,
  data: T,
  options?: { status?: number; meta?: ApiMeta; headers?: HeadersInit },
) {
  const id = requestId(request);
  return NextResponse.json(
    {
      ok: true,
      data,
      meta: { apiVersion: API_VERSION, requestId: id, ...options?.meta },
    },
    {
      status: options?.status ?? 200,
      headers: responseHeaders(id, options?.headers),
    },
  );
}

export function apiError(
  request: Request,
  status: number,
  error: {
    code: string;
    message: string;
    fieldErrors?: Record<string, string[]>;
    details?: Record<string, unknown>;
  },
) {
  const id = requestId(request);
  return NextResponse.json(
    {
      ok: false,
      error,
      meta: { apiVersion: API_VERSION, requestId: id },
    },
    { status, headers: responseHeaders(id) },
  );
}

function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const output: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "request";
    output[key] = [...(output[key] ?? []), issue.message];
  }
  return output;
}

export function parseInput<T>(
  request: Request,
  schema: z.ZodType<T>,
  value: unknown,
): { ok: true; data: T } | { ok: false; response: NextResponse } {
  const parsed = schema.safeParse(value);
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    response: apiError(request, 422, {
      code: "VALIDATION_ERROR",
      message: "请检查请求参数。",
      fieldErrors: fieldErrors(parsed.error),
    }),
  };
}

export async function parseJson<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return {
      ok: false,
      response: apiError(request, 400, {
        code: "INVALID_JSON",
        message: "请求正文必须是有效的 JSON。",
      }),
    };
  }
  return parseInput(request, schema, value);
}

export function handleApiError(request: Request, error: unknown) {
  if (error instanceof AppError) {
    const status = error.code.endsWith("_NOT_FOUND")
      ? 404
      : error.code.includes("CONFLICT")
        ? 409
        : 422;
    return apiError(request, status, {
      code: error.code,
      message: error.message,
      details: error.details,
    });
  }
  console.error(error);
  return apiError(request, 500, {
    code: "INTERNAL_ERROR",
    message: "服务暂时无法完成请求。",
  });
}

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(500).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export function pageMeta<T>(items: T[], page: number, limit: number) {
  const hasMore = items.length > limit;
  return {
    items: hasMore ? items.slice(0, limit) : items,
    meta: {
      page,
      limit,
      hasMore,
      nextPage: hasMore ? page + 1 : null,
    },
  };
}
