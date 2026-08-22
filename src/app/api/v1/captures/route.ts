import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  apiError,
  apiSuccess,
  handleApiError,
  pageMeta,
  paginationQuerySchema,
  parseInput,
  parseJson,
} from "@/features/api/http";
import { listCaptures } from "@/features/capture/queries";
import { createCaptureSchema } from "@/features/capture/schema";
import { createCapture } from "@/features/capture/service";

export const dynamic = "force-dynamic";

const listQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["active", "archived"]).default("active"),
  categoryId: z.uuid().optional(),
});
const createBodySchema = createCaptureSchema.omit({ idempotencyKey: true });
const idempotencyKeySchema = z.string().min(8).max(128);

export async function GET(request: Request) {
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = parseInput(request, listQuerySchema, query);
  if (!parsed.ok) return parsed.response;
  const { page, limit, status, categoryId } = parsed.data;
  try {
    const rows = await listCaptures({
      status,
      categoryId,
      limit: limit + 1,
      offset: (page - 1) * limit,
    });
    const paged = pageMeta(rows, page, limit);
    return apiSuccess(request, paged.items, { meta: paged.meta });
  } catch (error) {
    return handleApiError(request, error);
  }
}

export async function POST(request: Request) {
  const body = await parseJson(request, createBodySchema);
  if (!body.ok) return body.response;
  const key = idempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
  if (!key.success) {
    return apiError(request, 422, {
      code: "VALIDATION_ERROR",
      message: "请提供有效的 Idempotency-Key 请求头（8–128 个字符）。",
      fieldErrors: { idempotencyKey: ["Idempotency-Key 请求头为必填项。"] },
    });
  }
  try {
    const row = await createCapture({ ...body.data, idempotencyKey: key.data });
    revalidatePath("/");
    revalidatePath("/search");
    revalidatePath("/subjects");
    return apiSuccess(
      request,
      { id: row.id, version: row.version },
      {
        status: 201,
        headers: { Location: `/api/v1/captures/${row.id}` },
      },
    );
  } catch (error) {
    return handleApiError(request, error);
  }
}
