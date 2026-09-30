import { z } from "zod";

import { apiError, apiSuccess, handleApiError } from "@/features/api/http";
import { getAiRun } from "@/features/ai-processing/queries";

export const dynamic = "force-dynamic";

const runIdSchema = z.uuid();

/**
 * 读取单次 AI 运行的状态、用量、延迟、错误码，以及成功时对应的建议内容。
 *
 * 越权与不存在一律返回同一形态的 404，避免通过状态码确认他人 Run 是否存在。
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  if (!runIdSchema.safeParse(runId).success) {
    return apiError(request, 404, {
      code: "AI_RUN_NOT_FOUND",
      message: "AI 运行记录不存在。",
    });
  }
  try {
    const run = await getAiRun(runId);
    if (!run) {
      return apiError(request, 404, {
        code: "AI_RUN_NOT_FOUND",
        message: "AI 运行记录不存在。",
      });
    }
    return apiSuccess(request, run);
  } catch (error) {
    return handleApiError(request, error);
  }
}
