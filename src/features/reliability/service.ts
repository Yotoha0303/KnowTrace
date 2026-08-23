import "server-only";

import { desc, eq } from "drizzle-orm";

import type { ActionActor } from "@/features/auth/actor";
import { db } from "@/server/db/client";
import {
  claimEvidence,
  claimReviews,
  claims,
  independentClaimReviews,
  knowledgeReleases,
  sourceAuthorityAssessments,
} from "@/server/db/schema";
import { AppError } from "@/shared/errors/app-error";
import {
  requireClaimAccess,
  requireEvidenceAccess,
} from "@/features/auth/access";
import { sha256, stableStringify } from "@/shared/hash";

import { getReliabilityDossier } from "./queries";
import type { SourceAuthorityLevel } from "./schema";

function requireAuthenticatedActor(actor: ActionActor) {
  if (!actor.authenticated) {
    throw new AppError(
      "IDENTIFIED_REVIEWER_REQUIRED",
      "独立复核和可靠发布必须启用 go-user-system，并使用可识别的登录账号。",
    );
  }
}

export async function assessSourceAuthority(input: {
  evidenceId: string;
  level: SourceAuthorityLevel;
  publisher: string;
  rationale: string;
  actor: ActionActor;
}) {
  await requireEvidenceAccess(input.evidenceId);
  const [row] = await db
    .select({ evidence: claimEvidence, captureId: claims.captureId })
    .from(claimEvidence)
    .innerJoin(claims, eq(claimEvidence.claimId, claims.id))
    .where(eq(claimEvidence.id, input.evidenceId))
    .limit(1);
  if (!row) throw new AppError("CLAIM_EVIDENCE_NOT_FOUND", "证据不存在。");
  const [assessment] = await db
    .insert(sourceAuthorityAssessments)
    .values({
      evidenceId: row.evidence.id,
      evidenceVersion: row.evidence.version,
      level: input.level,
      publisher: input.publisher.trim(),
      rationale: input.rationale.trim(),
      assessorId: input.actor.id,
      assessorName: input.actor.name,
    })
    .returning({ id: sourceAuthorityAssessments.id });
  return { ...assessment, claimId: row.evidence.claimId, captureId: row.captureId };
}

export async function submitIndependentReview(input: {
  claimReviewId: string;
  decision: "approved" | "changes_requested";
  rationale: string;
  actor: ActionActor;
}) {
  requireAuthenticatedActor(input.actor);
  const [review] = await db
    .select({ review: claimReviews, claim: claims })
    .from(claimReviews)
    .innerJoin(claims, eq(claimReviews.claimId, claims.id))
    .where(eq(claimReviews.id, input.claimReviewId))
    .limit(1);
  if (!review) throw new AppError("CLAIM_REVIEW_NOT_FOUND", "人工结论不存在。");
  await requireClaimAccess(review.claim.id);
  if (review.review.reviewerId === input.actor.id) {
    throw new AppError(
      "INDEPENDENT_REVIEWER_REQUIRED",
      "结论作者不能复核自己的结论，请使用另一个登录账号。",
    );
  }
  const [latestReview] = await db
    .select({ id: claimReviews.id })
    .from(claimReviews)
    .where(eq(claimReviews.claimId, review.claim.id))
    .orderBy(desc(claimReviews.reviewNumber))
    .limit(1);
  if (latestReview?.id !== review.review.id || review.claim.status !== "concluded") {
    throw new AppError(
      "CLAIM_REVIEW_STALE",
      "只能复核当前已形成结论的最新版本。",
    );
  }
  const dossier = await getReliabilityDossier(review.claim.id, input.actor);
  if (!dossier?.review || dossier.review.id !== review.review.id) {
    throw new AppError("CLAIM_REVIEW_STALE", "结论输入已经变化，请刷新后重试。");
  }
  const inputSnapshot = {
    schemaVersion: "independent-review-input-v1",
    claim: {
      id: dossier.claim.id,
      statement: dossier.claim.statement,
      falsificationCriteria: dossier.claim.falsificationCriteria,
      status: dossier.claim.status,
    },
    review: {
      id: dossier.review.id,
      reviewNumber: dossier.review.reviewNumber,
      assessment: dossier.review.assessment,
      rationale: dossier.review.rationale,
      limitations: dossier.review.limitations,
      reviewerId: dossier.review.reviewerId,
    },
    evidence: dossier.evidence.map((item) => ({
      id: item.id,
      version: item.version,
      stance: item.stance,
      sourceContentHash: item.sourceContentHash,
      isCurrent: item.isCurrent,
      authority: item.authority
        ? {
            id: item.authority.id,
            level: item.authority.level,
            publisher: item.authority.publisher,
            rationale: item.authority.rationale,
          }
        : null,
    })),
  };
  const inputHash = sha256(stableStringify(inputSnapshot));
  try {
    const [created] = await db
      .insert(independentClaimReviews)
      .values({
        claimReviewId: review.review.id,
        decision: input.decision,
        rationale: input.rationale.trim(),
        inputHash,
        inputSnapshot,
        reviewerId: input.actor.id,
        reviewerName: input.actor.name,
      })
      .returning({ id: independentClaimReviews.id });
    return {
      ...created,
      claimId: review.claim.id,
      captureId: review.claim.captureId,
    };
  } catch (error) {
    if (
      typeof error === "object" &&
      error &&
      "code" in error &&
      String(error.code) === "23505"
    ) {
      throw new AppError(
        "INDEPENDENT_REVIEW_ALREADY_SUBMITTED",
        "你已经复核过这个结论版本；如需修改，应先退回调查并形成新结论。",
      );
    }
    throw error;
  }
}

export async function publishReliableKnowledge(input: {
  claimId: string;
  actor: ActionActor;
}) {
  requireAuthenticatedActor(input.actor);
  await requireClaimAccess(input.claimId);
  const dossier = await getReliabilityDossier(input.claimId, input.actor);
  if (!dossier) throw new AppError("CLAIM_NOT_FOUND", "主张不存在。");
  if (!dossier.readyToPublish || !dossier.review) {
    throw new AppError(
      "KNOWLEDGE_RELEASE_NOT_READY",
      "尚未满足可靠发布的全部门槛，请按页面清单补齐。",
    );
  }

  const snapshot = {
    schemaVersion: "knowledge-release-v1",
    claim: dossier.claim,
    review: dossier.review,
    evidence: dossier.evidence,
    independentReviews: dossier.independentReviews,
  };
  const snapshotHash = sha256(stableStringify(snapshot));
  const [existing] = await db
    .select({ id: knowledgeReleases.id, releaseNumber: knowledgeReleases.releaseNumber })
    .from(knowledgeReleases)
    .where(eq(knowledgeReleases.snapshotHash, snapshotHash))
    .limit(1);
  if (existing) {
    return { ...existing, claimId: dossier.claim.id, captureId: dossier.claim.captureId };
  }

  const [previous] = await db
    .select({ releaseNumber: knowledgeReleases.releaseNumber })
    .from(knowledgeReleases)
    .where(eq(knowledgeReleases.claimId, dossier.claim.id))
    .orderBy(desc(knowledgeReleases.releaseNumber))
    .limit(1);
  try {
    const [release] = await db
      .insert(knowledgeReleases)
      .values({
        claimId: dossier.claim.id,
        claimReviewId: dossier.review.id,
        releaseNumber: (previous?.releaseNumber ?? 0) + 1,
        snapshotHash,
        snapshot,
        publishedById: input.actor.id,
        publishedByName: input.actor.name,
      })
      .returning({
        id: knowledgeReleases.id,
        releaseNumber: knowledgeReleases.releaseNumber,
      });
    return {
      ...release,
      claimId: dossier.claim.id,
      captureId: dossier.claim.captureId,
    };
  } catch (error) {
    if (
      typeof error === "object" &&
      error &&
      "code" in error &&
      String(error.code) === "23505"
    ) {
      throw new AppError(
        "KNOWLEDGE_RELEASE_CONFLICT",
        "另一个发布操作已经完成，请刷新查看最新版本。",
      );
    }
    throw error;
  }
}
