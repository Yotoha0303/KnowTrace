import { currentTransferActor } from "@/features/data-transfer/auth";
import { PORTABLE_PACKAGE_V2_MAX_COMPRESSED_BYTES } from "@/features/data-transfer/package-v2";
import { stagePortablePackageV2Preview } from "@/features/data-transfer/service-v2";
import { toPublicError } from "@/shared/errors/app-error";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const actor = await currentTransferActor();
  if (!actor) {
    return Response.json(
      { error: { code: "UNAUTHORIZED", message: "请先登录。" } },
      { status: 401 },
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return Response.json(
        { error: { code: "FILE_REQUIRED", message: "请选择一个 KnowTrace v2 ZIP 交换包。" } },
        { status: 422 },
      );
    }
    if (!file.name.toLowerCase().endsWith(".zip")) {
      return Response.json(
        { error: { code: "INVALID_FILE_TYPE", message: "v2 导入仅支持 .zip 交换包。" } },
        { status: 422 },
      );
    }
    if (file.size < 1 || file.size > PORTABLE_PACKAGE_V2_MAX_COMPRESSED_BYTES) {
      return Response.json(
        {
          error: {
            code: "INVALID_FILE_SIZE",
            message: "v2 ZIP 必须大于 0 B，且压缩后不能超过 256 MiB。",
          },
        },
        { status: 422 },
      );
    }

    const result = await stagePortablePackageV2Preview({
      actor,
      fileName: file.name,
      buffer: Buffer.from(await file.arrayBuffer()),
    });
    return Response.json({ data: result });
  } catch (error) {
    const publicError = toPublicError(error);
    return Response.json(
      { error: publicError },
      { status: publicError.code === "INTERNAL_ERROR" ? 500 : 422 },
    );
  }
}
