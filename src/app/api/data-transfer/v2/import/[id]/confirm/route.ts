import { revalidatePath } from "next/cache";
import { z } from "zod";

import { currentTransferActor } from "@/features/data-transfer/auth";
import { confirmPortablePackageV2Import } from "@/features/data-transfer/service-v2";
import { toPublicError } from "@/shared/errors/app-error";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await currentTransferActor();
  if (!actor) {
    return Response.json(
      { error: { code: "UNAUTHORIZED", message: "请先登录。" } },
      { status: 401 },
    );
  }

  const parsed = z.uuid().safeParse((await context.params).id);
  if (!parsed.success) {
    return Response.json(
      { error: { code: "INVALID_IMPORT_RUN", message: "v2 导入预检标识无效。" } },
      { status: 422 },
    );
  }

  try {
    const result = await confirmPortablePackageV2Import(parsed.data, actor);
    revalidatePath("/");
    revalidatePath("/archived");
    revalidatePath("/categories");
    revalidatePath("/claims");
    revalidatePath("/search");
    revalidatePath("/subjects");
    return Response.json({ data: result });
  } catch (error) {
    const publicError = toPublicError(error);
    const status =
      publicError.code === "IMPORT_RUN_NOT_FOUND"
        ? 404
        : publicError.code === "INTERNAL_ERROR"
          ? 500
          : 409;
    return Response.json({ error: publicError }, { status });
  }
}
