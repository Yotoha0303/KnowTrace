import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  apiError,
  apiSuccess,
  handleApiError,
  parseInput,
  parseJson,
} from "@/features/api/http";
import { getCaptureDetail } from "@/features/capture/queries";
import { updateCaptureSchema } from "@/features/capture/schema";
import { deleteCapture, updateCapture } from "@/features/capture/service";

export const dynamic = "force-dynamic";

const idSchema = z.uuid();
const updateBodySchema = updateCaptureSchema.omit({ id: true });
const ifMatchSchema = z.coerce.number().int().positive();

function parseIfMatch(value: string | null) {
  const normalized = value?.trim().replace(/^W\//, "").replace(/^"|"$/g, "");
  return ifMatchSchema.safeParse(normalized);
}

async function captureId(request: Request, params: Promise<{ id: string }>) {
  const { id } = await params;
  return parseInput(request, idSchema, id);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = await captureId(request, params);
  if (!id.ok) return id.response;
  try {
    const row = await getCaptureDetail(id.data);
    return row
      ? apiSuccess(request, row, { headers: { ETag: `"${row.version}"` } })
      : apiError(request, 404, {
          code: "CAPTURE_NOT_FOUND",
          message: "记录不存在。",
        });
  } catch (error) {
    return handleApiError(request, error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = await captureId(request, params);
  if (!id.ok) return id.response;
  const body = await parseJson(request, updateBodySchema);
  if (!body.ok) return body.response;
  try {
    await updateCapture({ id: id.data, ...body.data });
    revalidatePath("/");
    revalidatePath(`/captures/${id.data}`);
    revalidatePath("/search");
    revalidatePath("/subjects");
    const row = await getCaptureDetail(id.data);
    return apiSuccess(request, row, {
      headers: row ? { ETag: `"${row.version}"` } : undefined,
    });
  } catch (error) {
    return handleApiError(request, error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = await captureId(request, params);
  if (!id.ok) return id.response;
  const version = parseIfMatch(request.headers.get("if-match"));
  if (!version.success) {
    return apiError(request, 428, {
      code: "PRECONDITION_REQUIRED",
      message: "永久删除前必须通过 If-Match 请求头提供当前版本号。",
      fieldErrors: { ifMatch: ["If-Match 必须是正整数版本号。"] },
    });
  }
  try {
    const deleted = await deleteCapture(id.data, version.data);
    revalidatePath("/");
    revalidatePath("/archived");
    revalidatePath("/claims");
    revalidatePath("/search");
    revalidatePath("/subjects");
    return apiSuccess(request, deleted);
  } catch (error) {
    return handleApiError(request, error);
  }
}
