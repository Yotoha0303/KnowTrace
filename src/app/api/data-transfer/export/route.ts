import { currentTransferActor } from "@/features/data-transfer/auth";
import { exportPortableData } from "@/features/data-transfer/service";
import { toPublicError } from "@/shared/errors/app-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const actor = await currentTransferActor();
  if (!actor) return Response.json({ error: { code: "UNAUTHORIZED", message: "请先登录。" } }, { status: 401 });
  try {
    const workbook = await exportPortableData();
    const date = new Date().toISOString().slice(0, 10);
    return new Response(new Uint8Array(workbook), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="knowtrace-export-${date}.xlsx"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const publicError = toPublicError(error);
    return Response.json({ error: publicError }, { status: 500 });
  }
}
