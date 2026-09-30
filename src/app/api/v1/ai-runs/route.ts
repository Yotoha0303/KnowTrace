import { z } from "zod";

import {
  apiSuccess,
  handleApiError,
  pageMeta,
  paginationQuerySchema,
  parseInput,
  parseJson,
} from "@/features/api/http";
import { listAiRuns } from "@/features/ai-processing/queries";
import { organizeCaptureSchema } from "@/features/ai-processing/schema";
import { organizeCapture } from "@/features/ai-processing/service";

export const dynamic = "force-dynamic";

const listQuerySchema = paginationQuerySchema.extend({
  captureId: z.uuid().optional(),
  status: z.enum(["running", "succeeded", "failed", "cancelled"]).optional(),
});

/**
 * 触发一次 AI 整理。
 *
 * 注意这是**同步阻塞**调用：`organizeCapture` 内部等待模型返回后才写 Suggestion，
 * 真实模型的实测延迟是 7–20 秒（见 docs/19 的 D-02）。客户端必须设置足够长的
 * 超时，并且**不要因为等待而重复提交**——每次调用都会新建一个 Run 并消耗额度。
 *
 * 之所以先交付同步版本：它复用现有 Service、不引入队列基础设施，可用于受控测量。
 * 异步化（立即返回 runId、客户端轮询）是移动端 M1 的前置条件，另行实现。
 *
 * 这里不做 revalidatePath：Web 端的 Server Action 已有自己的失效路径，
 * 本端点面向外部客户端，不参与 Next 的缓存失效。
 */
export async function POST(request: Request) {
  const body = await parseJson(request, organizeCaptureSchema);
  if (!body.ok) return body.response;
  try {
    const result = await organizeCapture(body.data);
    return apiSuccess(request, result, {
      status: 201,
      headers: { Location: `/api/v1/ai-runs/${result.runId}` },
    });
  } catch (error) {
    return handleApiError(request, error);
  }
}

export async function GET(request: Request) {
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = parseInput(request, listQuerySchema, query);
  if (!parsed.ok) return parsed.response;
  const { page, limit, captureId, status } = parsed.data;
  try {
    const rows = await listAiRuns({
      captureId,
      status,
      limit: limit + 1,
      offset: (page - 1) * limit,
    });
    const paged = pageMeta(rows, page, limit);
    return apiSuccess(request, paged.items, { meta: paged.meta });
  } catch (error) {
    return handleApiError(request, error);
  }
}
