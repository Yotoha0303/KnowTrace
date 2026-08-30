import "server-only";

import { and, asc, count, desc, eq, inArray } from "drizzle-orm";

import type { AIConnectionInput } from "@/features/ai-processing/schema";
import {
  getAISelection,
  synthesizeTopicWithAI,
  type AIProviderName,
} from "@/server/ai/provider";
import { db } from "@/server/db/client";
import {
  captureCategories,
  captures,
  categories,
  claimEvidence,
  claimReviews,
  claims,
  topicSyntheses,
} from "@/server/db/schema";
import { AppError } from "@/shared/errors/app-error";
import {
  requireCategoryAccess,
  requireCategoryReadAccess,
  requireTopicSynthesisAccess,
} from "@/features/auth/access";
import { captureReadCondition } from "@/features/auth/resource-scope";
import {
  sanitizeTopicSynthesisPayload,
  topicSourceHash,
  type TopicSourceSnapshot,
} from "./invariants";

const PROMPT_VERSION = "topic-synthesis-v1";
const SCHEMA_VERSION = "topic-synthesis-v1";
const MAX_CAPTURE_COUNT = 100;
const MAX_CAPTURE_CONTENT_CHARS = 3_000;
const MAX_TOTAL_CONTENT_CHARS = 30_000;

function topicErrorCode(error: unknown): string {
  if (error instanceof AppError) return error.code.slice(0, 80);
  if (typeof error === "object" && error && "name" in error) {
    return String(error.name).slice(0, 80);
  }
  return "TOPIC_SYNTHESIS_FAILED";
}

export async function buildTopicSourceSnapshot(
  categoryId: string,
): Promise<TopicSourceSnapshot> {
  const scope = await requireCategoryReadAccess(categoryId);
  const captureRows = await db
    .select({ capture: captures })
    .from(captureCategories)
    .innerJoin(captures, eq(captureCategories.captureId, captures.id))
    .where(
      and(
        eq(captureCategories.categoryId, categoryId),
        eq(captures.status, "active"),
        captureReadCondition(scope),
      ),
    )
    .orderBy(asc(captures.occurredAt), asc(captures.createdAt), asc(captures.id))
    .limit(MAX_CAPTURE_COUNT + 1);

  const selectedRows = captureRows.slice(0, MAX_CAPTURE_COUNT);
  const captureIds = selectedRows.map(({ capture }) => capture.id);
  if (!captureIds.length) {
    return { captures: [], claims: [], truncated: false };
  }

  const claimRows = await db
    .select({ claim: claims })
    .from(claims)
    .where(inArray(claims.captureId, captureIds))
    .orderBy(asc(claims.createdAt), asc(claims.id));
  const claimIds = claimRows.map(({ claim }) => claim.id);
  const [reviewRows, trustedEvidenceRows] = claimIds.length
    ? await Promise.all([
        db
          .select({ review: claimReviews })
          .from(claimReviews)
          .where(inArray(claimReviews.claimId, claimIds))
          .orderBy(desc(claimReviews.reviewNumber), desc(claimReviews.createdAt)),
        db
          .select({ claimId: claimEvidence.claimId, value: count() })
          .from(claimEvidence)
          .where(
            and(
              inArray(claimEvidence.claimId, claimIds),
              eq(claimEvidence.reviewStatus, "accepted"),
              eq(claimEvidence.sourceCheckStatus, "passed"),
              eq(claimEvidence.sourceExcerptMatch, true),
            ),
          )
          .groupBy(claimEvidence.claimId),
      ])
    : [[], []];

  const latestReviewByClaim = new Map<string, (typeof reviewRows)[number]["review"]>();
  for (const { review } of reviewRows) {
    if (!latestReviewByClaim.has(review.claimId)) {
      latestReviewByClaim.set(review.claimId, review);
    }
  }
  const trustedEvidenceByClaim = new Map(
    trustedEvidenceRows.map((row) => [row.claimId, Number(row.value)]),
  );

  let remainingChars = MAX_TOTAL_CONTENT_CHARS;
  let contentTruncated = false;
  const snapshotCaptures = selectedRows.map(({ capture }) => {
    const allowed = Math.max(0, Math.min(MAX_CAPTURE_CONTENT_CHARS, remainingChars));
    const content = capture.content.slice(0, allowed);
    if (content.length < capture.content.length) contentTruncated = true;
    remainingChars -= content.length;
    return {
      id: capture.id,
      title: capture.title,
      subject: capture.subject,
      content,
      contentType: capture.contentType,
      occurredAt: capture.occurredAt.toISOString(),
      version: capture.version,
    };
  });

  return {
    captures: snapshotCaptures,
    claims: claimRows.map(({ claim }) => {
      const review = latestReviewByClaim.get(claim.id);
      return {
        id: claim.id,
        captureId: claim.captureId,
        statement: claim.statement,
        status: claim.status,
        falsificationCriteria: claim.falsificationCriteria,
        latestReview: review
          ? {
              assessment: review.assessment,
              rationale: review.rationale,
              limitations: review.limitations,
              reviewNumber: review.reviewNumber,
            }
          : null,
        trustedEvidenceCount: trustedEvidenceByClaim.get(claim.id) ?? 0,
      };
    }),
    truncated: captureRows.length > MAX_CAPTURE_COUNT || contentTruncated,
  };
}

export async function generateTopicSynthesis(input: {
  categoryId: string;
  provider?: AIProviderName;
  connection?: AIConnectionInput;
}) {
  const scope = await requireCategoryAccess(input.categoryId);
  const [category] = await db
    .select()
    .from(categories)
    .where(eq(categories.id, input.categoryId))
    .limit(1);
  if (!category) throw new AppError("CATEGORY_NOT_FOUND", "分类不存在。");

  const snapshot = await buildTopicSourceSnapshot(category.id);
  if (!snapshot.captures.length) {
    throw new AppError("TOPIC_EMPTY", "主题中还没有活跃记录，无法生成综合档案。");
  }
  const selection = getAISelection(input.provider, input.connection);
  const requestId = crypto.randomUUID();
  const [run] = await db
    .insert(topicSyntheses)
    .values({
      workspaceId: scope.workspaceId,
      actorId: scope.actorId,
      actorName: scope.actorName,
      categoryId: category.id,
      sourceHash: topicSourceHash(snapshot),
      sourceSnapshot: snapshot,
      provider: selection.auditProvider,
      model: selection.model,
      promptVersion: PROMPT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      requestId,
    })
    .returning();
  const startedAt = Date.now();

  try {
    const result = await synthesizeTopicWithAI({
      topic: { id: category.id, name: category.name, description: category.description },
      snapshot,
      provider: input.provider,
      connection: input.connection,
    });
    const payload = sanitizeTopicSynthesisPayload(result.payload, snapshot);
    const [completed] = await db
      .update(topicSyntheses)
      .set({
        provider: result.provider,
        model: result.model,
        status: "succeeded",
        payload,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: Date.now() - startedAt,
        completedAt: new Date(),
      })
      .where(eq(topicSyntheses.id, run.id))
      .returning();
    return { id: completed.id, categoryId: category.id };
  } catch (error) {
    await db
      .update(topicSyntheses)
      .set({
        status: "failed",
        errorCode: topicErrorCode(error),
        latencyMs: Date.now() - startedAt,
        completedAt: new Date(),
      })
      .where(eq(topicSyntheses.id, run.id));
    throw error;
  }
}

export async function decideTopicSynthesis(input: {
  synthesisId: string;
  decision: "accepted" | "rejected";
}) {
  const scope = await requireTopicSynthesisAccess(input.synthesisId);
  const [target] = await db
    .select({ categoryId: topicSyntheses.categoryId, sourceHash: topicSyntheses.sourceHash })
    .from(topicSyntheses)
    .where(eq(topicSyntheses.id, input.synthesisId))
    .limit(1);
  if (!target) {
    throw new AppError("TOPIC_SYNTHESIS_NOT_FOUND", "主题档案不存在。");
  }
  const currentHash = topicSourceHash(
    await buildTopicSourceSnapshot(target.categoryId),
  );
  if (currentHash !== target.sourceHash) {
    throw new AppError(
      "TOPIC_SYNTHESIS_STALE",
      "主题输入已经变化，请重新生成后再接受。",
    );
  }
  const [updated] = await db
    .update(topicSyntheses)
    .set({
      decision: input.decision,
      decidedAt: new Date(),
      decidedById: scope.actorId,
      decidedByName: scope.actorName,
    })
    .where(
      and(
        eq(topicSyntheses.id, input.synthesisId),
        eq(topicSyntheses.status, "succeeded"),
        eq(topicSyntheses.decision, "pending"),
      ),
    )
    .returning({ id: topicSyntheses.id, categoryId: topicSyntheses.categoryId });
  if (!updated) {
    throw new AppError(
      "TOPIC_SYNTHESIS_DECISION_CONFLICT",
      "该档案已经处理或尚未生成成功，请刷新后重试。",
    );
  }
  return updated;
}
