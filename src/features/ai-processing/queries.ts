import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { currentDataAccessScope } from "@/features/auth/access";
import { captureReadCondition } from "@/features/auth/resource-scope";
import { db } from "@/server/db/client";
import { aiProcessingRuns, aiSuggestions, captures } from "@/server/db/schema";

export type AiRunStatus = "running" | "succeeded" | "failed" | "cancelled";

export type AiRunView = {
  id: string;
  captureId: string;
  captureVersion: number;
  taskType: string;
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  status: AiRunStatus;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  errorCode: string | null;
  requestId: string;
  startedAt: string;
  completedAt: string | null;
};

export type AiSuggestionView = {
  id: string;
  processingRunId: string;
  captureId: string;
  sourceCaptureVersion: number;
  schemaVersion: string;
  status: string;
  payload: unknown;
  createdAt: string;
};

const runColumns = {
  id: aiProcessingRuns.id,
  captureId: aiProcessingRuns.captureId,
  captureVersion: aiProcessingRuns.captureVersion,
  taskType: aiProcessingRuns.taskType,
  provider: aiProcessingRuns.provider,
  model: aiProcessingRuns.model,
  promptVersion: aiProcessingRuns.promptVersion,
  schemaVersion: aiProcessingRuns.schemaVersion,
  status: aiProcessingRuns.status,
  inputTokens: aiProcessingRuns.inputTokens,
  outputTokens: aiProcessingRuns.outputTokens,
  latencyMs: aiProcessingRuns.latencyMs,
  errorCode: aiProcessingRuns.errorCode,
  requestId: aiProcessingRuns.requestId,
  startedAt: aiProcessingRuns.startedAt,
  completedAt: aiProcessingRuns.completedAt,
} as const;

type RunRow = {
  id: string;
  captureId: string;
  captureVersion: number;
  taskType: string;
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  status: AiRunStatus;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  errorCode: string | null;
  requestId: string;
  startedAt: Date;
  completedAt: Date | null;
};

function toRunView(row: RunRow): AiRunView {
  return {
    id: row.id,
    captureId: row.captureId,
    captureVersion: row.captureVersion,
    taskType: row.taskType,
    provider: row.provider,
    model: row.model,
    promptVersion: row.promptVersion,
    schemaVersion: row.schemaVersion,
    status: row.status,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    latencyMs: row.latencyMs,
    errorCode: row.errorCode,
    requestId: row.requestId,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

/**
 * AI Run 不自己维护可见性规则，而是**复用 Capture 的读取条件**（ADR-0015：
 * 「新增任何读写入口必须从认证后端重新取得可信角色，并复用相同的数据范围规则」）。
 *
 * 这里必须走 join 而不是按 `ai_processing_runs.actor_id` 过滤：actor 只是发起者，
 * 记录可见性与创建者/管理员共享策略绑定。用 actor_id 过滤会让管理员共享内容的
 * Run 对普通成员不可见，与 Capture 的可见性不一致。
 */
function runScopeCondition(
  scope: Awaited<ReturnType<typeof currentDataAccessScope>>,
) {
  return captureReadCondition(scope);
}

export async function listAiRuns(input: {
  captureId?: string;
  status?: AiRunStatus;
  limit: number;
  offset: number;
}): Promise<AiRunView[]> {
  const scope = await currentDataAccessScope();
  const rows = await db
    .select(runColumns)
    .from(aiProcessingRuns)
    .innerJoin(captures, eq(aiProcessingRuns.captureId, captures.id))
    .where(
      and(
        runScopeCondition(scope),
        input.captureId ? eq(aiProcessingRuns.captureId, input.captureId) : undefined,
        input.status ? eq(aiProcessingRuns.status, input.status) : undefined,
      ),
    )
    .orderBy(desc(aiProcessingRuns.createdAt))
    .limit(input.limit)
    .offset(input.offset);
  return rows.map(toRunView);
}

export type AiRunDetail = AiRunView & { suggestion: AiSuggestionView | null };

export async function getAiRun(runId: string): Promise<AiRunDetail | null> {
  const scope = await currentDataAccessScope();
  const [run] = await db
    .select(runColumns)
    .from(aiProcessingRuns)
    .innerJoin(captures, eq(aiProcessingRuns.captureId, captures.id))
    .where(and(eq(aiProcessingRuns.id, runId), runScopeCondition(scope)))
    .limit(1);
  if (!run) return null;

  const [suggestion] = await db
    .select({
      id: aiSuggestions.id,
      processingRunId: aiSuggestions.processingRunId,
      captureId: aiSuggestions.captureId,
      sourceCaptureVersion: aiSuggestions.sourceCaptureVersion,
      schemaVersion: aiSuggestions.schemaVersion,
      status: aiSuggestions.status,
      payload: aiSuggestions.payload,
      createdAt: aiSuggestions.createdAt,
    })
    .from(aiSuggestions)
    .where(eq(aiSuggestions.processingRunId, run.id))
    .limit(1);

  return {
    ...toRunView(run),
    suggestion: suggestion
      ? { ...suggestion, createdAt: suggestion.createdAt.toISOString() }
      : null,
  };
}
