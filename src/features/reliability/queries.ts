import "server-only";

import { desc, eq, inArray } from "drizzle-orm";

import type { ActionActor } from "@/features/auth/actor";
import { db } from "@/server/db/client";
import {
  captures,
  claimEvidence,
  claimReviewEvidence,
  claimReviews,
  claims,
  independentClaimReviews,
  knowledgeReleases,
  sourceAuthorityAssessments,
} from "@/server/db/schema";
import { sha256, stableStringify } from "@/shared/hash";

import { evaluateReleaseReadiness, sourceIdentity } from "./readiness";

export type ReliabilityDossierDTO = {
  claim: {
    id: string;
    captureId: string;
    captureTitle: string | null;
    statement: string;
    falsificationCriteria: string;
    status: typeof claims.$inferSelect.status;
  };
  review: null | {
    id: string;
    reviewNumber: number;
    assessment: typeof claimReviews.$inferSelect.assessment;
    rationale: string;
    limitations: string | null;
    reviewerId: string;
    reviewerName: string;
    createdAt: string;
  };
  evidence: Array<{
    id: string;
    version: number;
    sourceTitle: string;
    excerpt: string;
    stance: typeof claimEvidence.$inferSelect.stance;
    finalUrl: string;
    sourceContentHash: string;
    sourceCheckedAt: string;
    sourceIdentity: string;
    isCurrent: boolean;
    authority: null | {
      id: string;
      level: typeof sourceAuthorityAssessments.$inferSelect.level;
      publisher: string;
      rationale: string;
      assessorName: string;
      createdAt: string;
    };
  }>;
  independentReviews: Array<{
    id: string;
    decision: typeof independentClaimReviews.$inferSelect.decision;
    rationale: string;
    reviewerId: string;
    reviewerName: string;
    inputHash: string;
    isStale: boolean;
    createdAt: string;
  }>;
  releases: Array<{
    id: string;
    releaseNumber: number;
    claimReviewId: string;
    snapshotHash: string;
    publishedByName: string;
    createdAt: string;
  }>;
  readiness: ReturnType<typeof evaluateReleaseReadiness>;
  readyToPublish: boolean;
};

export type KnowledgeReleaseDTO = {
  id: string;
  claimId: string;
  claimReviewId: string;
  releaseNumber: number;
  snapshotHash: string;
  snapshot: unknown;
  publishedByName: string;
  createdAt: string;
};

export async function listKnowledgeReleases(options?: {
  claimId?: string;
  limit?: number;
  offset?: number;
}): Promise<KnowledgeReleaseDTO[]> {
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);
  const offset = Math.min(Math.max(options?.offset ?? 0, 0), 25_000);
  const rows = await db
    .select()
    .from(knowledgeReleases)
    .where(options?.claimId ? eq(knowledgeReleases.claimId, options.claimId) : undefined)
    .orderBy(desc(knowledgeReleases.createdAt), desc(knowledgeReleases.id))
    .limit(limit)
    .offset(offset);

  return rows.map((row) => ({
    id: row.id,
    claimId: row.claimId,
    claimReviewId: row.claimReviewId,
    releaseNumber: row.releaseNumber,
    snapshotHash: row.snapshotHash,
    snapshot: row.snapshot,
    publishedByName: row.publishedByName,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function getReliabilityDossier(
  claimId: string,
  actor: ActionActor,
): Promise<ReliabilityDossierDTO | null> {
  const [claimRow] = await db
    .select({ claim: claims, captureTitle: captures.title })
    .from(claims)
    .innerJoin(captures, eq(claims.captureId, captures.id))
    .where(eq(claims.id, claimId))
    .limit(1);
  if (!claimRow) return null;

  const [review] = await db
    .select()
    .from(claimReviews)
    .where(eq(claimReviews.claimId, claimId))
    .orderBy(desc(claimReviews.reviewNumber), desc(claimReviews.createdAt))
    .limit(1);

  const [snapshotRows, independentRows, releaseRows] = await Promise.all([
    review
      ? db
          .select({
            snapshot: claimReviewEvidence,
            currentEvidence: claimEvidence,
          })
          .from(claimReviewEvidence)
          .innerJoin(claimEvidence, eq(claimReviewEvidence.evidenceId, claimEvidence.id))
          .where(eq(claimReviewEvidence.reviewId, review.id))
          .orderBy(claimReviewEvidence.evidenceId)
      : Promise.resolve([]),
    review
      ? db
          .select()
          .from(independentClaimReviews)
          .where(eq(independentClaimReviews.claimReviewId, review.id))
          .orderBy(desc(independentClaimReviews.createdAt))
      : Promise.resolve([]),
    db
      .select()
      .from(knowledgeReleases)
      .where(eq(knowledgeReleases.claimId, claimId))
      .orderBy(desc(knowledgeReleases.releaseNumber)),
  ]);

  const evidenceIds = snapshotRows.map(({ currentEvidence }) => currentEvidence.id);
  const authorityRows = evidenceIds.length
    ? await db
        .select()
        .from(sourceAuthorityAssessments)
        .where(inArray(sourceAuthorityAssessments.evidenceId, evidenceIds))
        .orderBy(desc(sourceAuthorityAssessments.createdAt))
    : [];
  const latestAuthority = new Map<string, (typeof authorityRows)[number]>();
  for (const authority of authorityRows) {
    const evidence = snapshotRows.find(
      ({ currentEvidence }) => currentEvidence.id === authority.evidenceId,
    )?.currentEvidence;
    if (
      evidence &&
      authority.evidenceVersion === evidence.version &&
      !latestAuthority.has(authority.evidenceId)
    ) {
      latestAuthority.set(authority.evidenceId, authority);
    }
  }

  const evidence = snapshotRows.map(({ snapshot, currentEvidence }) => {
    const authority = latestAuthority.get(currentEvidence.id);
    const authorityDTO = authority
      ? {
          id: authority.id,
          level: authority.level,
          publisher: authority.publisher,
          rationale: authority.rationale,
          assessorName: authority.assessorName,
          createdAt: authority.createdAt.toISOString(),
        }
      : null;
    return {
      id: currentEvidence.id,
      version: currentEvidence.version,
      sourceTitle: snapshot.sourceTitle,
      excerpt: snapshot.excerpt,
      stance: snapshot.stance,
      finalUrl: snapshot.finalUrl,
      sourceContentHash: snapshot.sourceContentHash,
      sourceCheckedAt: snapshot.sourceCheckedAt.toISOString(),
      sourceIdentity: sourceIdentity({
        id: currentEvidence.id,
        finalUrl: snapshot.finalUrl,
        authority: authorityDTO,
      }),
      isCurrent:
        currentEvidence.reviewStatus === "accepted" &&
        currentEvidence.sourceCheckStatus === "passed" &&
        currentEvidence.sourceExcerptMatch === true &&
        currentEvidence.latestSourceCheckId === snapshot.sourceCheckId,
      authority: authorityDTO,
    };
  });
  const independentInputSnapshot = review
    ? {
        schemaVersion: "independent-review-input-v1",
        claim: {
          id: claimRow.claim.id,
          statement: claimRow.claim.statement,
          falsificationCriteria: claimRow.claim.falsificationCriteria,
          status: claimRow.claim.status,
        },
        review: {
          id: review.id,
          reviewNumber: review.reviewNumber,
          assessment: review.assessment,
          rationale: review.rationale,
          limitations: review.limitations,
          reviewerId: review.reviewerId,
        },
        evidence: evidence.map((item) => ({
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
      }
    : null;
  const independentInputHash = independentInputSnapshot
    ? sha256(stableStringify(independentInputSnapshot))
    : null;
  const independentReviews = independentRows.map((item) => ({
    id: item.id,
    decision: item.decision,
    rationale: item.rationale,
    reviewerId: item.reviewerId,
    reviewerName: item.reviewerName,
    inputHash: item.inputHash,
    isStale: item.inputHash !== independentInputHash,
    createdAt: item.createdAt.toISOString(),
  }));
  const readiness = evaluateReleaseReadiness({
    authenticated: actor.authenticated,
    claimStatus: claimRow.claim.status,
    review: review ? { id: review.id, reviewerId: review.reviewerId } : null,
    evidence: snapshotRows.map(({ snapshot, currentEvidence }) => {
      const authority = latestAuthority.get(currentEvidence.id);
      return {
        id: currentEvidence.id,
        currentReviewStatus: currentEvidence.reviewStatus,
        currentSourceCheckStatus: currentEvidence.sourceCheckStatus,
        currentExcerptMatch: currentEvidence.sourceExcerptMatch,
        currentSourceCheckId: currentEvidence.latestSourceCheckId,
        snapshotSourceCheckId: snapshot.sourceCheckId,
        finalUrl: snapshot.finalUrl,
        authority: authority
          ? { level: authority.level, publisher: authority.publisher }
          : null,
      };
    }),
    independentReviews,
  });

  return {
    claim: {
      id: claimRow.claim.id,
      captureId: claimRow.claim.captureId,
      captureTitle: claimRow.captureTitle,
      statement: claimRow.claim.statement,
      falsificationCriteria: claimRow.claim.falsificationCriteria,
      status: claimRow.claim.status,
    },
    review: review
      ? {
          id: review.id,
          reviewNumber: review.reviewNumber,
          assessment: review.assessment,
          rationale: review.rationale,
          limitations: review.limitations,
          reviewerId: review.reviewerId,
          reviewerName: review.reviewerName,
          createdAt: review.createdAt.toISOString(),
        }
      : null,
    evidence,
    independentReviews,
    releases: releaseRows.map((release) => ({
      id: release.id,
      releaseNumber: release.releaseNumber,
      claimReviewId: release.claimReviewId,
      snapshotHash: release.snapshotHash,
      publishedByName: release.publishedByName,
      createdAt: release.createdAt.toISOString(),
    })),
    readiness,
    readyToPublish: readiness.every((check) => check.passed),
  };
}
