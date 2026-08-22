import { currentTransferActor } from "@/features/data-transfer/auth";
import { DATA_TRANSFER_MAX_FILE_BYTES } from "@/features/data-transfer/contracts";
import { previewPortableImport } from "@/features/data-transfer/service";
import { toPublicError } from "@/shared/errors/app-error";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const actor = await currentTransferActor();
  if (!actor) return Response.json({ error: { code: "UNAUTHORIZED", message: "请先登录。" } }, { status: 401 });
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return Response.json({ error: { code: "FILE_REQUIRED", message: "请选择一个 .xlsx 文件。" } }, { status: 422 });
    if (!file.name.toLowerCase().endsWith(".xlsx")) return Response.json({ error: { code: "INVALID_FILE_TYPE", message: "仅支持 .xlsx 文件。" } }, { status: 422 });
    if (file.size < 1 || file.size > DATA_TRANSFER_MAX_FILE_BYTES) return Response.json({ error: { code: "INVALID_FILE_SIZE", message: "文件必须大于 0 B，且不能超过 5 MB。" } }, { status: 422 });
    const result = await previewPortableImport({ actor, fileName: file.name, buffer: Buffer.from(await file.arrayBuffer()) });
    return Response.json({ data: result });
  } catch (error) {
    const publicError = toPublicError(error);
    return Response.json({ error: publicError }, { status: publicError.code === "INTERNAL_ERROR" ? 500 : 422 });
  }
}
