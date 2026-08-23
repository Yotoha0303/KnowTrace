import "server-only";

import { and, count, countDistinct, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/server/db/client";
import {
  captureCategories,
  captures,
  categories,
  claimEvidence,
  claimReviews,
  claims,
} from "@/server/db/schema";
import { currentDataAccessScope } from "@/features/auth/access";

export type CategoryDossierDTO = {
  category: {
    id: string;
    name: string;
    description: string | null;
    status: "active" | "archived";
  };
  metrics: {
    activeCaptures: number;
    archivedCaptures: number;
    claims: number;
    evidence: number;
    trustedEvidence: number;
    concludedClaims: number;
  };
  claimStatuses: Record<
    "candidate" | "investigating" | "ready_for_review" | "concluded" | "withdrawn",
    number
  >;
  latestConclusions: Array<{
    id: string;
    claimId: string;
    captureId: string;
    captureTitle: string | null;
    statement: string;
    assessment: "supported" | "refuted" | "inconclusive";
    reviewNumber: number;
    rationale: string;
    limitations: string | null;
    createdAt: string;
  }>;
};

export async function getCategoryDossier(id: string): Promise<CategoryDossierDTO | null> {
  const scope = await currentDataAccessScope();
  const [category] = await db
    .select()
    .from(categories)
    .where(
      and(
        eq(categories.id, id),
        scope.isAdmin ? undefined : eq(categories.createdById, scope.actorId),
      ),
    )
    .limit(1);
  if (!category) return null;

  const categoryCaptures = db
    .select({ captureId: captureCategories.captureId })
    .from(captureCategories)
    .where(eq(captureCategories.categoryId, id));

  const [captureStatusRows, claimStatusRows, evidenceRows, conclusionCountRows, reviewRows] =
    await Promise.all([
      db
        .select({ status: captures.status, value: count() })
        .from(captures)
        .where(inArray(captures.id, categoryCaptures))
        .groupBy(captures.status),
      db
        .select({ status: claims.status, value: count() })
        .from(claims)
        .innerJoin(captures, eq(claims.captureId, captures.id))
        .where(and(eq(captures.status, "active"), inArray(claims.captureId, categoryCaptures)))
        .groupBy(claims.status),
      db
        .select({
          value: count(),
          trusted: sql<number>`count(*) filter (where ${claimEvidence.reviewStatus} = 'accepted' and ${claimEvidence.sourceCheckStatus} = 'passed' and ${claimEvidence.sourceExcerptMatch} = true)`,
        })
        .from(claimEvidence)
        .innerJoin(claims, eq(claimEvidence.claimId, claims.id))
        .innerJoin(captures, eq(claims.captureId, captures.id))
        .where(and(eq(captures.status, "active"), inArray(claims.captureId, categoryCaptures))),
      db
        .select({ value: countDistinct(claimReviews.claimId) })
        .from(claimReviews)
        .innerJoin(claims, eq(claimReviews.claimId, claims.id))
        .innerJoin(captures, eq(claims.captureId, captures.id))
        .where(and(eq(captures.status, "active"), inArray(claims.captureId, categoryCaptures))),
      db
        .select({
          id: claimReviews.id,
          claimId: claims.id,
          captureId: claims.captureId,
          captureTitle: captures.title,
          statement: claims.statement,
          assessment: claimReviews.assessment,
          reviewNumber: claimReviews.reviewNumber,
          rationale: claimReviews.rationale,
          limitations: claimReviews.limitations,
          createdAt: claimReviews.createdAt,
        })
        .from(claimReviews)
        .innerJoin(claims, eq(claimReviews.claimId, claims.id))
        .innerJoin(captures, eq(claims.captureId, captures.id))
        .where(and(eq(captures.status, "active"), inArray(claims.captureId, categoryCaptures)))
        .orderBy(desc(claimReviews.createdAt), desc(claimReviews.reviewNumber))
        .limit(200),
    ]);

  const captureCounts = new Map(captureStatusRows.map((row) => [row.status, Number(row.value)]));
  const claimStatuses: CategoryDossierDTO["claimStatuses"] = {
    candidate: 0,
    investigating: 0,
    ready_for_review: 0,
    concluded: 0,
    withdrawn: 0,
  };
  for (const row of claimStatusRows) claimStatuses[row.status] = Number(row.value);

  const latestByClaim = new Map<string, (typeof reviewRows)[number]>();
  for (const review of reviewRows) {
    if (!latestByClaim.has(review.claimId)) latestByClaim.set(review.claimId, review);
  }
  const latestConclusions = [...latestByClaim.values()].slice(0, 6).map((review) => ({
    ...review,
    createdAt: review.createdAt.toISOString(),
  }));

  return {
    category: {
      id: category.id,
      name: category.name,
      description: category.description,
      status: category.status,
    },
    metrics: {
      activeCaptures: captureCounts.get("active") ?? 0,
      archivedCaptures: captureCounts.get("archived") ?? 0,
      claims: Object.values(claimStatuses).reduce((total, value) => total + value, 0),
      evidence: Number(evidenceRows[0]?.value ?? 0),
      trustedEvidence: Number(evidenceRows[0]?.trusted ?? 0),
      concludedClaims: Number(conclusionCountRows[0]?.value ?? 0),
    },
    claimStatuses,
    latestConclusions,
  };
}
