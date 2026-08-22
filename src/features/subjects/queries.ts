import "server-only";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/server/db/client";
import {
  captureCategories,
  captures,
  categories,
  claimReviews,
  claims,
} from "@/server/db/schema";

import { normalizeSubjectPath } from "./utils";

export type SubjectSummaryDTO = {
  name: string;
  captureCount: number;
  firstOccurredAt: string;
  lastOccurredAt: string;
};

export type SubjectTimelineDTO = {
  subject: string;
  firstOccurredAt: string;
  lastOccurredAt: string;
  captures: Array<{
    id: string;
    title: string | null;
    content: string;
    contentType: typeof captures.$inferSelect.contentType;
    occurredAt: string;
    createdAt: string;
    updatedAt: string;
    categories: Array<{ id: string; name: string }>;
    claims: Array<{
      id: string;
      statement: string;
      status: typeof claims.$inferSelect.status;
      latestAssessment: null | {
        assessment: typeof claimReviews.$inferSelect.assessment;
        rationale: string;
        limitations: string | null;
        reviewNumber: number;
        createdAt: string;
      };
    }>;
  }>;
};

const normalizedSubject = sql<string>`lower(btrim(${captures.subject}))`;

export async function listSubjectSummaries(): Promise<SubjectSummaryDTO[]> {
  const rows = await db
    .select({
      name: sql<string>`min(btrim(${captures.subject}))`,
      captureCount: sql<number>`count(*)`,
      firstOccurredAt: sql<Date>`min(${captures.occurredAt})`,
      lastOccurredAt: sql<Date>`max(${captures.occurredAt})`,
    })
    .from(captures)
    .where(
      and(
        eq(captures.status, "active"),
        sql`${captures.subject} is not null`,
        sql`btrim(${captures.subject}) <> ''`,
      ),
    )
    .groupBy(normalizedSubject)
    .orderBy(desc(sql`max(${captures.occurredAt})`), asc(sql`min(btrim(${captures.subject}))`))
    .limit(200);

  return rows.map((row) => ({
    name: row.name,
    captureCount: Number(row.captureCount),
    firstOccurredAt: row.firstOccurredAt.toISOString(),
    lastOccurredAt: row.lastOccurredAt.toISOString(),
  }));
}

export async function getSubjectTimeline(rawSubject: string): Promise<SubjectTimelineDTO | null> {
  const subject = normalizeSubjectPath(rawSubject);
  if (!subject) return null;

  const captureRows = await db
    .select()
    .from(captures)
    .where(
      and(
        eq(captures.status, "active"),
        sql`${normalizedSubject} = lower(btrim(${subject}))`,
      ),
    )
    .orderBy(asc(captures.occurredAt), asc(captures.createdAt), asc(captures.id))
    .limit(200);
  if (!captureRows.length) return null;

  const captureIds = captureRows.map((capture) => capture.id);
  const [categoryRows, claimRows] = await Promise.all([
    db
      .select({
        captureId: captureCategories.captureId,
        id: categories.id,
        name: categories.name,
      })
      .from(captureCategories)
      .innerJoin(categories, eq(captureCategories.categoryId, categories.id))
      .where(inArray(captureCategories.captureId, captureIds))
      .orderBy(categories.name),
    db
      .select({ claim: claims })
      .from(claims)
      .where(inArray(claims.captureId, captureIds))
      .orderBy(asc(claims.createdAt), asc(claims.id)),
  ]);

  const claimIds = claimRows.map(({ claim }) => claim.id);
  const reviewRows = claimIds.length
    ? await db
        .select()
        .from(claimReviews)
        .where(inArray(claimReviews.claimId, claimIds))
        .orderBy(desc(claimReviews.reviewNumber), desc(claimReviews.createdAt))
    : [];

  const categoriesByCapture = new Map<string, Array<{ id: string; name: string }>>();
  for (const row of categoryRows) {
    categoriesByCapture.set(row.captureId, [
      ...(categoriesByCapture.get(row.captureId) ?? []),
      { id: row.id, name: row.name },
    ]);
  }
  const latestReviewByClaim = new Map<string, (typeof reviewRows)[number]>();
  for (const review of reviewRows) {
    if (!latestReviewByClaim.has(review.claimId)) latestReviewByClaim.set(review.claimId, review);
  }
  const claimsByCapture = new Map<string, SubjectTimelineDTO["captures"][number]["claims"]>();
  for (const { claim } of claimRows) {
    const review = latestReviewByClaim.get(claim.id);
    claimsByCapture.set(claim.captureId, [
      ...(claimsByCapture.get(claim.captureId) ?? []),
      {
        id: claim.id,
        statement: claim.statement,
        status: claim.status,
        latestAssessment: review
          ? {
              assessment: review.assessment,
              rationale: review.rationale,
              limitations: review.limitations,
              reviewNumber: review.reviewNumber,
              createdAt: review.createdAt.toISOString(),
            }
          : null,
      },
    ]);
  }

  return {
    subject: captureRows[0].subject?.trim() || subject,
    firstOccurredAt: captureRows[0].occurredAt.toISOString(),
    lastOccurredAt: captureRows.at(-1)!.occurredAt.toISOString(),
    captures: captureRows.map((capture) => ({
      id: capture.id,
      title: capture.title,
      content: capture.content,
      contentType: capture.contentType,
      occurredAt: capture.occurredAt.toISOString(),
      createdAt: capture.createdAt.toISOString(),
      updatedAt: capture.updatedAt.toISOString(),
      categories: categoriesByCapture.get(capture.id) ?? [],
      claims: claimsByCapture.get(capture.id) ?? [],
    })),
  };
}
