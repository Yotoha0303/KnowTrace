import { and, desc, eq, inArray } from "drizzle-orm";

import { normalizeCategoryName } from "@/features/classification/schema";
import { addCategoriesToCapture } from "@/features/classification/service";
import {
  aiProcessingRuns,
  aiSuggestions,
  claimAiAudits,
  claimEvidence,
  claimReviews,
  claims,
  captureCategories,
  captureRevisions,
  captures,
  categories,
  evidenceSourceChecks,
} from "@/server/db/schema";
import { db } from "@/server/db/client";
import {
  getAISelection,
  auditClaimWithAI,
  organizeWithAI,
  type AIProviderName,
} from "@/server/ai/provider";
import { AppError } from "@/shared/errors/app-error";
import { sha256, stableStringify } from "@/shared/hash";

import {
  aiSuggestionPayloadSchema,
  MAX_AI_CATEGORY_CANDIDATES,
  MAX_AI_NEW_CATEGORY_CANDIDATES,
  MAX_CAPTURE_CATEGORIES_AFTER_AI,
  MAX_CONTENT_SUGGESTIONS,
  MAX_CLAIM_CANDIDATES,
  type AIConnectionInput,
  type AISuggestionPayload,
} from "./schema";
import { applySelectedContentSuggestions } from "./content-edits";
import {
  claimAuditEvidenceFingerprint,
  sanitizeClaimAuditPayload,
  type ClaimAuditEvidenceInput,
} from "./claim-audit";

const PROMPT_VERSION = "organize-v2";
const SCHEMA_VERSION = "suggestion-v2";
const CLAIM_AUDIT_PROMPT_VERSION = "claim-audit-v1";
const CLAIM_AUDIT_SCHEMA_VERSION = "claim-audit-v1";

function errorCode(error: unknown): string {
  if (error instanceof AppError) return error.code;
  if (typeof error === "object" && error && "name" in error) {
    return String(error.name).slice(0, 80);
  }
  return "AI_REQUEST_FAILED";
}

function sanitizePayload(
  payload: AISuggestionPayload,
  source: string,
  activeCategoryRows: Array<{ id: string; name: string }>,
  assignedCategoryIds: Set<string>,
): AISuggestionPayload {
  const validCategoryIds = new Set(activeCategoryRows.map(({ id }) => id));
  const activeCategoryNames = new Set(
    activeCategoryRows.map(({ name }) => normalizeCategoryName(name)),
  );
  const validSemanticUnits = payload.semantic_units.filter(
    (unit) => !source.includes(unit.source_excerpt),
  );
  const invalidSemanticExcerpts = validSemanticUnits.length;
  const safeSemanticUnits = payload.semantic_units.filter((unit) =>
    source.includes(unit.source_excerpt),
  );

  const safeContentSuggestions: AISuggestionPayload["content_suggestions"] = [];
  const occupiedRanges: Array<{ start: number; end: number }> = [];
  let invalidContentSuggestions = 0;
  for (const suggestion of [...payload.content_suggestions].sort(
    (left, right) => right.confidence - left.confidence,
  )) {
    const start = source.indexOf(suggestion.source_excerpt);
    const end = start + suggestion.source_excerpt.length;
    const overlaps = occupiedRanges.some(
      (range) => start < range.end && end > range.start,
    );
    const replacesWholeSource = suggestion.source_excerpt.trim() === source.trim();
    if (
      start < 0 ||
      overlaps ||
      replacesWholeSource ||
      suggestion.suggested_text === suggestion.source_excerpt
    ) {
      invalidContentSuggestions += 1;
      continue;
    }
    occupiedRanges.push({ start, end });
    safeContentSuggestions.push(suggestion);
    if (safeContentSuggestions.length >= MAX_CONTENT_SUGGESTIONS) break;
  }

  const seenClaims = new Set<string>();
  let invalidClaimCandidates = 0;
  const safeClaimCandidates = [...payload.claim_candidates]
    .sort((left, right) => right.confidence - left.confidence)
    .filter((candidate) => {
      const key = candidate.statement.trim().toLocaleLowerCase("zh-CN");
      if (
        !source.includes(candidate.source_excerpt) ||
        !key ||
        seenClaims.has(key) ||
        candidate.confidence < 0.6
      ) {
        invalidClaimCandidates += 1;
        return false;
      }
      seenClaims.add(key);
      return true;
    })
    .slice(0, MAX_CLAIM_CANDIDATES);

  const seenCategoryIds = new Set<string>();
  const existingCandidates = payload.existing_category_candidates
    .filter((candidate) => {
      if (
        !validCategoryIds.has(candidate.category_id) ||
        assignedCategoryIds.has(candidate.category_id) ||
        seenCategoryIds.has(candidate.category_id)
      ) {
        return false;
      }
      seenCategoryIds.add(candidate.category_id);
      return true;
    })
    .sort((left, right) => right.confidence - left.confidence);
  const seenNames = new Set<string>();
  const newCandidates = payload.new_category_candidates
    .filter((candidate) => {
      const normalized = normalizeCategoryName(candidate.name);
      if (
        !normalized ||
        candidate.confidence < 0.65 ||
        seenNames.has(normalized) ||
        activeCategoryNames.has(normalized)
      ) {
        return false;
      }
      seenNames.add(normalized);
      return true;
    })
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, MAX_AI_NEW_CATEGORY_CANDIDATES);
  const rankedCategories = [
    ...existingCandidates.map((candidate) => ({ kind: "existing" as const, candidate })),
    ...newCandidates.map((candidate) => ({ kind: "new" as const, candidate })),
  ]
    .sort((left, right) => right.candidate.confidence - left.candidate.confidence)
    .slice(0, MAX_AI_CATEGORY_CANDIDATES);

  const extraFlags: AISuggestionPayload["quality_flags"] = [];
  if (invalidSemanticExcerpts > 0) {
    extraFlags.push({
      code: "INVALID_SOURCE_EXCERPT_REMOVED",
      message: `已移除 ${invalidSemanticExcerpts} 个无法在原文中定位的语义单元。`,
    });
  }
  if (invalidContentSuggestions > 0) {
    extraFlags.push({
      code: "INVALID_CONTENT_SUGGESTION_REMOVED",
      message: `已移除 ${invalidContentSuggestions} 条不安全或重叠的原文修改建议。`,
    });
  }
  if (invalidClaimCandidates > 0) {
    extraFlags.push({
      code: "INVALID_CLAIM_CANDIDATE_REMOVED",
      message: `已移除 ${invalidClaimCandidates} 条无法追溯、重复或置信度过低的主张候选。`,
    });
  }

  return aiSuggestionPayloadSchema.parse({
    ...payload,
    existing_category_candidates: rankedCategories.flatMap((item) =>
      item.kind === "existing" ? [item.candidate] : [],
    ),
    new_category_candidates: rankedCategories.flatMap((item) =>
      item.kind === "new" ? [item.candidate] : [],
    ),
    content_suggestions: safeContentSuggestions,
    claim_candidates: safeClaimCandidates,
    semantic_units: safeSemanticUnits,
    quality_flags: [...payload.quality_flags, ...extraFlags].slice(0, 10),
  });
}

export async function organizeCapture(input: {
  captureId: string;
  expectedCaptureVersion: number;
  provider?: AIProviderName;
  connection?: AIConnectionInput;
}) {
  const [capture] = await db
    .select()
    .from(captures)
    .where(eq(captures.id, input.captureId))
    .limit(1);
  if (!capture) throw new AppError("CAPTURE_NOT_FOUND", "记录不存在。");
  if (capture.version !== input.expectedCaptureVersion) {
    throw new AppError("CAPTURE_VERSION_CONFLICT", "记录已经更新，请刷新后重试。");
  }

  const [activeCategories, assignedCategoryRows] = await Promise.all([
    db
      .select()
      .from(categories)
      .where(eq(categories.status, "active"))
      .orderBy(categories.name),
    db
      .select({ categoryId: captureCategories.categoryId })
      .from(captureCategories)
      .where(eq(captureCategories.captureId, capture.id)),
  ]);
  const assignedCategoryIds = new Set(
    assignedCategoryRows.map(({ categoryId }) => categoryId),
  );
  const selection = getAISelection(input.provider, input.connection);
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const inputHash = sha256(
    stableStringify({
      captureId: capture.id,
      version: capture.version,
      title: capture.title,
      content: capture.content,
      contentType: capture.contentType,
      provider: selection.auditProvider,
      model: selection.model,
      categories: activeCategories.map(({ id, name }) => ({ id, name })),
    }),
  );

  const [run] = await db
    .insert(aiProcessingRuns)
    .values({
      captureId: capture.id,
      captureVersion: capture.version,
      inputHash,
      provider: selection.auditProvider,
      model: selection.model,
      promptVersion: PROMPT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      requestId,
    })
    .returning();

  try {
    const result = await organizeWithAI({
      capture,
      categories: activeCategories,
      assignedCategoryIds: [...assignedCategoryIds],
      provider: input.provider,
      connection: input.connection,
    });
    const payload = sanitizePayload(
      result.payload,
      capture.content,
      activeCategories,
      assignedCategoryIds,
    );

    const suggestion = await db.transaction(async (transaction) => {
      const [created] = await transaction
        .insert(aiSuggestions)
        .values({
          processingRunId: run.id,
          captureId: capture.id,
          sourceCaptureVersion: capture.version,
          schemaVersion: SCHEMA_VERSION,
          payload,
        })
        .returning();
      await transaction
        .update(aiProcessingRuns)
        .set({
          status: "succeeded",
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          latencyMs: Date.now() - startedAt,
          completedAt: new Date(),
        })
        .where(eq(aiProcessingRuns.id, run.id));
      return created;
    });

    return { runId: run.id, suggestionId: suggestion.id, requestId };
  } catch (error) {
    await db
      .update(aiProcessingRuns)
      .set({
        status: "failed",
        errorCode: errorCode(error),
        latencyMs: Date.now() - startedAt,
        completedAt: new Date(),
      })
      .where(eq(aiProcessingRuns.id, run.id));
    if (error instanceof AppError) throw error;
    throw new AppError(
      "AI_PROCESSING_FAILED",
      "AI 整理失败，失败状态已经记录；你可以稍后重试，原始内容没有变化。",
    );
  }
}

export async function auditClaim(input: {
  claimId: string;
  provider?: AIProviderName;
  connection?: AIConnectionInput;
}) {
  const [claimContext] = await db
    .select({ claim: claims, captureVersion: captures.version })
    .from(claims)
    .innerJoin(captures, eq(claims.captureId, captures.id))
    .where(eq(claims.id, input.claimId))
    .limit(1);
  if (!claimContext) throw new AppError("CLAIM_NOT_FOUND", "主张不存在。");
  if (claimContext.claim.status === "withdrawn") {
    throw new AppError(
      "CLAIM_AI_AUDIT_STATE_INVALID",
      "已撤回的主张不能运行 AI 可靠性审查。",
    );
  }

  const [evidenceRows, latestReview] = await Promise.all([
    db
      .select({
        id: claimEvidence.id,
        stance: claimEvidence.stance,
        sourceUrl: claimEvidence.sourceUrl,
        sourceTitle: claimEvidence.sourceTitle,
        excerpt: claimEvidence.excerpt,
        note: claimEvidence.note,
        sourceCheckId: evidenceSourceChecks.id,
        verificationMethod: evidenceSourceChecks.verificationMethod,
        finalUrl: evidenceSourceChecks.finalUrl,
        contentHash: evidenceSourceChecks.contentHash,
        sourceCheckedAt: evidenceSourceChecks.checkedAt,
      })
      .from(claimEvidence)
      .innerJoin(
        evidenceSourceChecks,
        eq(claimEvidence.latestSourceCheckId, evidenceSourceChecks.id),
      )
      .where(
        and(
          eq(claimEvidence.claimId, claimContext.claim.id),
          eq(claimEvidence.reviewStatus, "accepted"),
          eq(claimEvidence.sourceCheckStatus, "passed"),
          eq(claimEvidence.sourceExcerptMatch, true),
          eq(evidenceSourceChecks.status, "passed"),
          eq(evidenceSourceChecks.excerptMatch, true),
        ),
      ),
    db
      .select({
        assessment: claimReviews.assessment,
        rationale: claimReviews.rationale,
        limitations: claimReviews.limitations,
      })
      .from(claimReviews)
      .where(eq(claimReviews.claimId, claimContext.claim.id))
      .orderBy(desc(claimReviews.reviewNumber))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);
  const evidence: ClaimAuditEvidenceInput[] = evidenceRows.flatMap((row) =>
    row.finalUrl && row.contentHash
      ? [
          {
            ...row,
            finalUrl: row.finalUrl,
            contentHash: row.contentHash,
            sourceCheckedAt: row.sourceCheckedAt.toISOString(),
          },
        ]
      : [],
  );
  const sourceEvidenceFingerprint = claimAuditEvidenceFingerprint(evidence);
  const selection = getAISelection(input.provider, input.connection);
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const inputHash = sha256(
    stableStringify({
      claimId: claimContext.claim.id,
      statement: claimContext.claim.statement,
      falsificationCriteria: claimContext.claim.falsificationCriteria,
      status: claimContext.claim.status,
      sourceClaimUpdatedAt: claimContext.claim.updatedAt.toISOString(),
      sourceEvidenceFingerprint,
      latestReview,
      provider: selection.auditProvider,
      model: selection.model,
    }),
  );

  const [run] = await db
    .insert(aiProcessingRuns)
    .values({
      captureId: claimContext.claim.captureId,
      captureVersion: claimContext.captureVersion,
      inputHash,
      taskType: "claim_audit",
      provider: selection.auditProvider,
      model: selection.model,
      promptVersion: CLAIM_AUDIT_PROMPT_VERSION,
      schemaVersion: CLAIM_AUDIT_SCHEMA_VERSION,
      requestId,
    })
    .returning();

  try {
    const result = await auditClaimWithAI({
      claim: claimContext.claim,
      evidence,
      latestReview,
      provider: input.provider,
      connection: input.connection,
    });
    const payload = sanitizeClaimAuditPayload(result.payload, evidence);
    const audit = await db.transaction(async (transaction) => {
      const [created] = await transaction
        .insert(claimAiAudits)
        .values({
          processingRunId: run.id,
          claimId: claimContext.claim.id,
          sourceClaimUpdatedAt: claimContext.claim.updatedAt,
          sourceEvidenceFingerprint,
          schemaVersion: CLAIM_AUDIT_SCHEMA_VERSION,
          evidenceSnapshot: evidence,
          payload,
        })
        .returning({ id: claimAiAudits.id });
      await transaction
        .update(aiProcessingRuns)
        .set({
          status: "succeeded",
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          latencyMs: Date.now() - startedAt,
          completedAt: new Date(),
        })
        .where(eq(aiProcessingRuns.id, run.id));
      return created;
    });

    return {
      id: audit.id,
      captureId: claimContext.claim.captureId,
      requestId,
    };
  } catch (error) {
    await db
      .update(aiProcessingRuns)
      .set({
        status: "failed",
        errorCode: errorCode(error),
        latencyMs: Date.now() - startedAt,
        completedAt: new Date(),
      })
      .where(eq(aiProcessingRuns.id, run.id));
    if (error instanceof AppError) throw error;
    throw new AppError(
      "CLAIM_AI_AUDIT_FAILED",
      "AI 可靠性审查失败，失败状态已经记录；主张、证据与人工结论都没有变化。",
    );
  }
}

export async function decideSuggestion(input: {
  suggestionId: string;
  decision: "accepted" | "modified" | "rejected";
  acceptedFields?: {
    title?: string | null;
    contentType?: AISuggestionPayload["content_type"];
    existingCategoryIds?: string[];
    newCategoryNames?: string[];
    contentSuggestionIndexes?: number[];
    claimCandidateIndexes?: number[];
  };
}) {
  return db.transaction(async (transaction) => {
    const [suggestion] = await transaction
      .select()
      .from(aiSuggestions)
      .where(eq(aiSuggestions.id, input.suggestionId))
      .for("update")
      .limit(1);
    if (!suggestion) throw new AppError("AI_SUGGESTION_NOT_FOUND", "AI 建议不存在。");
    if (suggestion.status !== "pending") {
      throw new AppError("AI_SUGGESTION_ALREADY_DECIDED", "这条 AI 建议已经处理。");
    }

    if (input.decision === "rejected") {
      const [updated] = await transaction
        .update(aiSuggestions)
        .set({ status: "rejected", decidedAt: new Date() })
        .where(and(eq(aiSuggestions.id, suggestion.id), eq(aiSuggestions.status, "pending")))
        .returning();
      if (!updated) throw new AppError("AI_SUGGESTION_ALREADY_DECIDED", "这条 AI 建议已经处理。");
      return { captureId: suggestion.captureId, captureVersion: suggestion.sourceCaptureVersion };
    }

    const [capture] = await transaction
      .select()
      .from(captures)
      .where(eq(captures.id, suggestion.captureId))
      .for("update")
      .limit(1);
    if (!capture) throw new AppError("CAPTURE_NOT_FOUND", "记录不存在。");
    if (capture.version !== suggestion.sourceCaptureVersion) {
      await transaction
        .update(aiSuggestions)
        .set({ status: "stale", decidedAt: new Date() })
        .where(eq(aiSuggestions.id, suggestion.id));
      return { captureId: capture.id, captureVersion: capture.version, stale: true as const };
    }

    const payload = aiSuggestionPayloadSchema.parse(suggestion.payload);
    const title = input.acceptedFields?.title ?? payload.suggested_title;
    const contentType = input.acceptedFields?.contentType ?? payload.content_type;
    const allowedExistingCategoryIds = new Set(
      payload.existing_category_candidates.map((candidate) => candidate.category_id),
    );
    const allowedNewCategoryNames = new Set(
      payload.new_category_candidates.map((candidate) => normalizeCategoryName(candidate.name)),
    );
    const requestedExistingCategoryIds =
      input.acceptedFields?.existingCategoryIds ??
      payload.existing_category_candidates.map((candidate) => candidate.category_id);
    const requestedNewCategoryNames = input.acceptedFields?.newCategoryNames ?? [];
    const requestedContentSuggestionIndexes = [
      ...new Set(input.acceptedFields?.contentSuggestionIndexes ?? []),
    ].filter((index) => index < payload.content_suggestions.length);
    const requestedClaimCandidateIndexes = [
      ...new Set(input.acceptedFields?.claimCandidateIndexes ?? []),
    ]
      .filter((index) => index < payload.claim_candidates.length)
      .slice(0, MAX_CLAIM_CANDIDATES);
    const content = applySelectedContentSuggestions(
      capture.content,
      payload.content_suggestions,
      requestedContentSuggestionIndexes,
    );

    const currentCategoryLinks = await transaction
      .select({
        categoryId: captureCategories.categoryId,
        assignedBy: captureCategories.assignedBy,
      })
      .from(captureCategories)
      .where(eq(captureCategories.captureId, capture.id));
    const manualCategoryIds = new Set(
      currentCategoryLinks
        .filter(({ assignedBy }) => assignedBy === "manual")
        .map(({ categoryId }) => categoryId),
    );
    const availableAISlots = Math.max(
      0,
      MAX_CAPTURE_CATEGORIES_AFTER_AI - manualCategoryIds.size,
    );
    const existingCategoryIds = [...new Set(requestedExistingCategoryIds)]
      .filter(
        (id) => allowedExistingCategoryIds.has(id) && !manualCategoryIds.has(id),
      )
      .slice(0, Math.min(MAX_AI_CATEGORY_CANDIDATES, availableAISlots));
    const availableNewSlots = Math.min(
      MAX_AI_NEW_CATEGORY_CANDIDATES,
      Math.max(0, availableAISlots - existingCategoryIds.length),
    );
    const newCategoryNames = requestedNewCategoryNames
      .filter((name) => allowedNewCategoryNames.has(normalizeCategoryName(name)))
      .slice(0, availableNewSlots);

    const normalizedNames = [...new Set(newCategoryNames.map(normalizeCategoryName))].filter(Boolean);
    const newCategoryIds: string[] = [];
    for (const normalizedName of normalizedNames) {
      const sourceName = newCategoryNames.find(
        (name) => normalizeCategoryName(name) === normalizedName,
      )!;
      const [created] = await transaction
        .insert(categories)
        .values({ name: sourceName.trim(), normalizedName })
        .onConflictDoNothing({ target: categories.normalizedName })
        .returning({ id: categories.id });
      if (created) {
        newCategoryIds.push(created.id);
      } else {
        const [existing] = await transaction
          .select({ id: categories.id })
          .from(categories)
          .where(and(eq(categories.normalizedName, normalizedName), eq(categories.status, "active")))
          .limit(1);
        if (existing) newCategoryIds.push(existing.id);
      }
    }

    const activeExisting = existingCategoryIds.length
      ? await transaction
          .select({ id: categories.id })
          .from(categories)
          .where(
            and(
              inArray(categories.id, [...new Set(existingCategoryIds)]),
              eq(categories.status, "active"),
            ),
          )
      : [];
    await transaction
      .delete(captureCategories)
      .where(
        and(
          eq(captureCategories.captureId, capture.id),
          eq(captureCategories.assignedBy, "ai_accepted"),
        ),
      );
    await addCategoriesToCapture(
      transaction,
      capture.id,
      [...activeExisting.map(({ id }) => id), ...newCategoryIds],
      "ai_accepted",
    );

    const captureChanged =
      title !== capture.title ||
      contentType !== capture.contentType ||
      content !== capture.content;
    let captureVersion = capture.version;
    if (captureChanged) {
      await transaction.insert(captureRevisions).values({
        captureId: capture.id,
        version: capture.version,
        title: capture.title,
        subject: capture.subject,
        content: capture.content,
        contentType: capture.contentType,
        occurredAt: capture.occurredAt,
      });
      captureVersion += 1;
      await transaction
        .update(captures)
        .set({
          title: title?.trim() || null,
          content,
          contentType,
          version: captureVersion,
          updatedAt: new Date(),
        })
        .where(and(eq(captures.id, capture.id), eq(captures.version, capture.version)));
    }

    const acceptedPayload = {
      title: title?.trim() || null,
      contentType,
      existingCategoryIds: activeExisting.map(({ id }) => id),
      newCategoryNames,
      contentSuggestionIndexes: requestedContentSuggestionIndexes,
      claimCandidateIndexes: requestedClaimCandidateIndexes,
    };
    for (const index of requestedClaimCandidateIndexes) {
      const candidate = payload.claim_candidates[index];
      const statementHash = sha256(
        stableStringify({
          captureId: capture.id,
          sourceCaptureVersion: suggestion.sourceCaptureVersion,
          statement: candidate.statement.trim().toLocaleLowerCase("zh-CN"),
        }),
      );
      await transaction
        .insert(claims)
        .values({
          captureId: capture.id,
          sourceSuggestionId: suggestion.id,
          sourceCaptureVersion: suggestion.sourceCaptureVersion,
          statement: candidate.statement.trim(),
          statementHash,
          sourceExcerpt: candidate.source_excerpt,
          falsificationCriteria: candidate.falsification_criteria.trim(),
        })
        .onConflictDoNothing({ target: claims.statementHash });
    }
    const [updated] = await transaction
      .update(aiSuggestions)
      .set({
        status: input.decision,
        acceptedPayload,
        decidedAt: new Date(),
      })
      .where(and(eq(aiSuggestions.id, suggestion.id), eq(aiSuggestions.status, "pending")))
      .returning();
    if (!updated) throw new AppError("AI_SUGGESTION_ALREADY_DECIDED", "这条 AI 建议已经处理。");

    return { captureId: capture.id, captureVersion, stale: false as const };
  });
}
