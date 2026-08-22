import { and, count, desc, eq } from "drizzle-orm";

import type { ClaimStatus } from "./schema";
import {
  assessmentHasRequiredStance,
  canTransitionClaim,
  hasConfirmedEvidenceSource,
  hasRequiredEvidenceForReview,
} from "./state";
import {
  claimEvidence,
  claimReviewEvidence,
  claimReviews,
  claims,
  evidenceSourceChecks,
} from "@/server/db/schema";
import { db } from "@/server/db/client";
import { AppError } from "@/shared/errors/app-error";
import { inspectEvidenceSource } from "./source-inspector";

export async function transitionClaim(input: {
  claimId: string;
  expectedStatus: ClaimStatus;
  targetStatus: ClaimStatus;
}) {
  if (!canTransitionClaim(input.expectedStatus, input.targetStatus)) {
    throw new AppError(
      "CLAIM_TRANSITION_INVALID",
      "当前主张状态不允许执行这个操作。",
    );
  }

  const [claim] = await db
    .select({ id: claims.id, captureId: claims.captureId, status: claims.status })
    .from(claims)
    .where(eq(claims.id, input.claimId))
    .limit(1);
  if (!claim) throw new AppError("CLAIM_NOT_FOUND", "候选主张不存在。");
  if (claim.status !== input.expectedStatus) {
    throw new AppError(
      "CLAIM_STATUS_CONFLICT",
      "主张状态已经变化，请刷新后重试。",
    );
  }

  if (input.targetStatus === "ready_for_review") {
    const [summary] = await db
      .select({ count: count() })
      .from(claimEvidence)
      .where(
        and(
          eq(claimEvidence.claimId, claim.id),
          eq(claimEvidence.reviewStatus, "accepted"),
          eq(claimEvidence.sourceCheckStatus, "passed"),
          eq(claimEvidence.sourceExcerptMatch, true),
        ),
      );
    if (!hasRequiredEvidenceForReview(Number(summary?.count ?? 0))) {
      throw new AppError(
        "CLAIM_ACCEPTED_EVIDENCE_REQUIRED",
        "至少需要一条已采纳证据，才能提交待审核。",
      );
    }
  }

  const [updated] = await db
    .update(claims)
    .set({ status: input.targetStatus, updatedAt: new Date() })
    .where(
      and(
        eq(claims.id, claim.id),
        eq(claims.status, input.expectedStatus),
      ),
    )
    .returning({ id: claims.id, captureId: claims.captureId, status: claims.status });
  if (!updated) {
    throw new AppError(
      "CLAIM_STATUS_CONFLICT",
      "主张状态已经变化，请刷新后重试。",
    );
  }
  return updated;
}

export async function addClaimEvidence(input: {
  claimId: string;
  sourceUrl: string;
  sourceTitle: string;
  excerpt: string;
  stance: "supports" | "contradicts" | "context";
  note?: string;
}) {
  const [claim] = await db
    .select({ id: claims.id, captureId: claims.captureId, status: claims.status })
    .from(claims)
    .where(eq(claims.id, input.claimId))
    .limit(1);
  if (!claim) throw new AppError("CLAIM_NOT_FOUND", "候选主张不存在。");
  if (claim.status !== "investigating") {
    throw new AppError(
      "CLAIM_EVIDENCE_STATE_INVALID",
      "只有调查中的主张可以添加证据。",
    );
  }

  const [evidence] = await db
    .insert(claimEvidence)
    .values({
      claimId: claim.id,
      sourceUrl: input.sourceUrl,
      sourceTitle: input.sourceTitle,
      excerpt: input.excerpt,
      stance: input.stance,
      note: input.note || null,
    })
    .returning({ id: claimEvidence.id });
  return { ...evidence, captureId: claim.captureId };
}

export async function checkClaimEvidenceSource(input: { evidenceId: string }) {
  const [row] = await db
    .select({
      evidenceId: claimEvidence.id,
      sourceUrl: claimEvidence.sourceUrl,
      excerpt: claimEvidence.excerpt,
      reviewStatus: claimEvidence.reviewStatus,
      claimStatus: claims.status,
      captureId: claims.captureId,
    })
    .from(claimEvidence)
    .innerJoin(claims, eq(claimEvidence.claimId, claims.id))
    .where(eq(claimEvidence.id, input.evidenceId))
    .limit(1);
  if (!row) throw new AppError("CLAIM_EVIDENCE_NOT_FOUND", "证据不存在。");
  if (row.claimStatus !== "investigating" || row.reviewStatus !== "unreviewed") {
    throw new AppError(
      "CLAIM_EVIDENCE_SOURCE_CHECK_STATE_INVALID",
      "只有调查中且尚未审核的证据可以检查来源。",
    );
  }

  const inspection = await inspectEvidenceSource({
    sourceUrl: row.sourceUrl,
    excerpt: row.excerpt,
  });
  const checkedAt = new Date();

  return db.transaction(async (transaction) => {
    const [current] = await transaction
      .select({
        reviewStatus: claimEvidence.reviewStatus,
        claimStatus: claims.status,
      })
      .from(claimEvidence)
      .innerJoin(claims, eq(claimEvidence.claimId, claims.id))
      .where(eq(claimEvidence.id, row.evidenceId))
      .limit(1);
    if (
      !current ||
      current.claimStatus !== "investigating" ||
      current.reviewStatus !== "unreviewed"
    ) {
      throw new AppError(
        "CLAIM_EVIDENCE_SOURCE_CHECK_STATE_INVALID",
        "证据状态已经变化，本次来源检查未写入。",
      );
    }

    const [attempt] = await transaction
      .insert(evidenceSourceChecks)
      .values({
        evidenceId: row.evidenceId,
        requestedUrl: inspection.requestedUrl,
        finalUrl: inspection.finalUrl,
        status: inspection.status,
        httpStatus: inspection.httpStatus,
        contentType: inspection.contentType,
        contentHash: inspection.contentHash,
        fetchedTitle: inspection.fetchedTitle,
        excerptMatch: inspection.excerptMatch,
        responseBytes: inspection.responseBytes,
        errorCode: inspection.errorCode,
        checkedAt,
      })
      .returning({ id: evidenceSourceChecks.id });

    const [updated] = await transaction
      .update(claimEvidence)
      .set({
        sourceCheckStatus: inspection.status,
        sourceExcerptMatch: inspection.excerptMatch,
        sourceCheckedAt: checkedAt,
        latestSourceCheckId: attempt.id,
      })
      .where(
        and(
          eq(claimEvidence.id, row.evidenceId),
          eq(claimEvidence.reviewStatus, "unreviewed"),
        ),
      )
      .returning({ id: claimEvidence.id });
    if (!updated) {
      throw new AppError(
        "CLAIM_EVIDENCE_SOURCE_CHECK_STATE_INVALID",
        "证据状态已经变化，本次来源检查未写入。",
      );
    }
    return {
      id: updated.id,
      captureId: row.captureId,
      status: inspection.status,
      excerptMatch: inspection.excerptMatch,
      errorCode: inspection.errorCode,
    };
  });
}

export async function reviewClaimEvidence(input: {
  evidenceId: string;
  decision: "accepted" | "rejected";
}) {
  const [row] = await db
    .select({
      evidenceId: claimEvidence.id,
      reviewStatus: claimEvidence.reviewStatus,
      sourceCheckStatus: claimEvidence.sourceCheckStatus,
      sourceExcerptMatch: claimEvidence.sourceExcerptMatch,
      latestSourceCheckId: claimEvidence.latestSourceCheckId,
      claimStatus: claims.status,
      captureId: claims.captureId,
    })
    .from(claimEvidence)
    .innerJoin(claims, eq(claimEvidence.claimId, claims.id))
    .where(eq(claimEvidence.id, input.evidenceId))
    .limit(1);
  if (!row) throw new AppError("CLAIM_EVIDENCE_NOT_FOUND", "证据不存在。");
  if (row.claimStatus !== "investigating") {
    throw new AppError(
      "CLAIM_EVIDENCE_STATE_INVALID",
      "只有调查中的主张可以审核证据。",
    );
  }
  if (row.reviewStatus !== "unreviewed") {
    throw new AppError(
      "CLAIM_EVIDENCE_ALREADY_REVIEWED",
      "这条证据已经完成审核。",
    );
  }
  if (
    input.decision === "accepted" &&
    !hasConfirmedEvidenceSource({
      status: row.sourceCheckStatus,
      excerptMatch: row.sourceExcerptMatch,
      latestCheckId: row.latestSourceCheckId,
    })
  ) {
    throw new AppError(
      "CLAIM_EVIDENCE_SOURCE_NOT_CONFIRMED",
      "采纳前必须成功检查来源，并确认摘录存在于来源内容中。",
    );
  }

  const [updated] = await db
    .update(claimEvidence)
    .set({ reviewStatus: input.decision, reviewedAt: new Date() })
    .where(
      and(
        eq(claimEvidence.id, input.evidenceId),
        eq(claimEvidence.reviewStatus, "unreviewed"),
        ...(input.decision === "accepted"
          ? [
              eq(claimEvidence.sourceCheckStatus, "passed"),
              eq(claimEvidence.sourceExcerptMatch, true),
              eq(claimEvidence.latestSourceCheckId, row.latestSourceCheckId!),
            ]
          : []),
      ),
    )
    .returning({ id: claimEvidence.id });
  if (!updated) {
    throw new AppError(
      "CLAIM_EVIDENCE_ALREADY_REVIEWED",
      "这条证据已经完成审核。",
    );
  }
  return { ...updated, captureId: row.captureId };
}

export async function concludeClaim(input: {
  claimId: string;
  assessment: "supported" | "refuted" | "inconclusive";
  rationale: string;
  limitations?: string;
}) {
  return db.transaction(async (transaction) => {
    const [claim] = await transaction
      .update(claims)
      .set({ status: "concluded", updatedAt: new Date() })
      .where(
        and(
          eq(claims.id, input.claimId),
          eq(claims.status, "ready_for_review"),
        ),
      )
      .returning({ id: claims.id, captureId: claims.captureId });
    if (!claim) {
      throw new AppError(
        "CLAIM_STATUS_CONFLICT",
        "只有待审核的主张可以形成结论，请刷新后重试。",
      );
    }

    const acceptedEvidence = await transaction
      .select({
        evidenceId: claimEvidence.id,
        sourceCheckId: evidenceSourceChecks.id,
        stance: claimEvidence.stance,
        sourceUrl: claimEvidence.sourceUrl,
        sourceTitle: claimEvidence.sourceTitle,
        excerpt: claimEvidence.excerpt,
        finalUrl: evidenceSourceChecks.finalUrl,
        sourceContentHash: evidenceSourceChecks.contentHash,
        sourceCheckedAt: evidenceSourceChecks.checkedAt,
      })
      .from(claimEvidence)
      .innerJoin(
        evidenceSourceChecks,
        eq(claimEvidence.latestSourceCheckId, evidenceSourceChecks.id),
      )
      .where(
        and(
          eq(claimEvidence.claimId, claim.id),
          eq(claimEvidence.reviewStatus, "accepted"),
          eq(claimEvidence.sourceCheckStatus, "passed"),
          eq(claimEvidence.sourceExcerptMatch, true),
          eq(evidenceSourceChecks.status, "passed"),
          eq(evidenceSourceChecks.excerptMatch, true),
        ),
      );
    if (!acceptedEvidence.length) {
      throw new AppError(
        "CLAIM_ACCEPTED_EVIDENCE_REQUIRED",
        "形成结论前至少需要一条来源已确认的采纳证据。",
      );
    }
    if (
      input.assessment === "supported" &&
      !assessmentHasRequiredStance(
        input.assessment,
        acceptedEvidence.map((evidence) => evidence.stance),
      )
    ) {
      throw new AppError(
        "CLAIM_SUPPORTING_EVIDENCE_REQUIRED",
        "“得到支持”的结论至少需要一条已采纳的支持证据。",
      );
    }
    if (
      input.assessment === "refuted" &&
      !assessmentHasRequiredStance(
        input.assessment,
        acceptedEvidence.map((evidence) => evidence.stance),
      )
    ) {
      throw new AppError(
        "CLAIM_CONTRADICTING_EVIDENCE_REQUIRED",
        "“已被反驳”的结论至少需要一条已采纳的反驳证据。",
      );
    }
    if (
      acceptedEvidence.some(
        (evidence) => !evidence.finalUrl || !evidence.sourceContentHash,
      )
    ) {
      throw new AppError(
        "CLAIM_EVIDENCE_SNAPSHOT_INVALID",
        "证据来源快照不完整，无法形成结论。",
      );
    }

    const [previousReview] = await transaction
      .select({ reviewNumber: claimReviews.reviewNumber })
      .from(claimReviews)
      .where(eq(claimReviews.claimId, claim.id))
      .orderBy(desc(claimReviews.reviewNumber))
      .limit(1);
    const [review] = await transaction
      .insert(claimReviews)
      .values({
        claimId: claim.id,
        reviewNumber: (previousReview?.reviewNumber ?? 0) + 1,
        assessment: input.assessment,
        rationale: input.rationale.trim(),
        limitations: input.limitations?.trim() || null,
      })
      .returning({
        id: claimReviews.id,
        reviewNumber: claimReviews.reviewNumber,
        assessment: claimReviews.assessment,
      });
    await transaction.insert(claimReviewEvidence).values(
      acceptedEvidence.map((evidence) => ({
        reviewId: review.id,
        evidenceId: evidence.evidenceId,
        sourceCheckId: evidence.sourceCheckId,
        stance: evidence.stance,
        sourceUrl: evidence.sourceUrl,
        sourceTitle: evidence.sourceTitle,
        excerpt: evidence.excerpt,
        finalUrl: evidence.finalUrl!,
        sourceContentHash: evidence.sourceContentHash!,
        sourceCheckedAt: evidence.sourceCheckedAt,
      })),
    );
    return { ...review, captureId: claim.captureId };
  });
}
