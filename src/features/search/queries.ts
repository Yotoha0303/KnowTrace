import "server-only";

import { and, desc, eq, inArray, or, sql } from "drizzle-orm";

import { db } from "@/server/db/client";
import {
  captureCategories,
  captures,
  categories,
  claimEvidence,
  claimReviews,
  claims,
} from "@/server/db/schema";
import { buildSearchPattern, makeSearchSnippet, normalizeSearchQuery } from "./utils";

export type SearchEntityType = "all" | "capture" | "claim" | "evidence" | "conclusion";

export type KnowledgeSearchItem = {
  id: string;
  type: Exclude<SearchEntityType, "all">;
  captureId: string;
  captureTitle: string | null;
  title: string;
  excerpt: string;
  status: string;
  categories: Array<{ id: string; name: string }>;
  updatedAt: string;
};

export type KnowledgeSearchResult = {
  query: string;
  groups: {
    captures: KnowledgeSearchItem[];
    claims: KnowledgeSearchItem[];
    evidence: KnowledgeSearchItem[];
    conclusions: KnowledgeSearchItem[];
  };
  returnedCount: number;
};

const emptyGroups = (): KnowledgeSearchResult["groups"] => ({
  captures: [],
  claims: [],
  evidence: [],
  conclusions: [],
});

async function categoriesByCaptureIds(captureIds: string[]) {
  if (!captureIds.length) return new Map<string, Array<{ id: string; name: string }>>();
  const rows = await db
    .select({ captureId: captureCategories.captureId, id: categories.id, name: categories.name })
    .from(captureCategories)
    .innerJoin(categories, eq(captureCategories.categoryId, categories.id))
    .where(inArray(captureCategories.captureId, [...new Set(captureIds)]))
    .orderBy(categories.name);
  const grouped = new Map<string, Array<{ id: string; name: string }>>();
  for (const row of rows) {
    const values = grouped.get(row.captureId) ?? [];
    values.push({ id: row.id, name: row.name });
    grouped.set(row.captureId, values);
  }
  return grouped;
}

export async function searchKnowledge(options: {
  query?: string;
  type?: SearchEntityType;
  categoryId?: string;
  limitPerType?: number;
}): Promise<KnowledgeSearchResult> {
  const query = normalizeSearchQuery(options.query);
  const groups = emptyGroups();
  if (!query) return { query, groups, returnedCount: 0 };

  const type = options.type ?? "all";
  const limit = Math.min(Math.max(options.limitPerType ?? 20, 1), 50);
  const pattern = buildSearchPattern(query);
  const categoryCaptureIds = options.categoryId
    ? db
        .select({ captureId: captureCategories.captureId })
        .from(captureCategories)
        .where(eq(captureCategories.categoryId, options.categoryId))
    : undefined;

  const [captureRows, claimRows, evidenceRows, conclusionRows] = await Promise.all([
    type === "all" || type === "capture"
      ? db
          .select({
            id: captures.id,
            title: captures.title,
            content: captures.content,
            status: captures.status,
            updatedAt: captures.updatedAt,
          })
          .from(captures)
          .where(
            and(
              categoryCaptureIds ? inArray(captures.id, categoryCaptureIds) : undefined,
              sql<boolean>`(coalesce(${captures.title}, '') || ' ' || ${captures.content}) ILIKE ${pattern}`,
            ),
          )
          .orderBy(desc(captures.updatedAt), desc(captures.id))
          .limit(limit)
      : Promise.resolve([]),
    type === "all" || type === "claim"
      ? db
          .select({
            id: claims.id,
            captureId: claims.captureId,
            captureTitle: captures.title,
            statement: claims.statement,
            sourceExcerpt: claims.sourceExcerpt,
            falsificationCriteria: claims.falsificationCriteria,
            status: claims.status,
            updatedAt: claims.updatedAt,
          })
          .from(claims)
          .innerJoin(captures, eq(claims.captureId, captures.id))
          .where(
            and(
              categoryCaptureIds ? inArray(claims.captureId, categoryCaptureIds) : undefined,
              sql<boolean>`(${claims.statement} || ' ' || ${claims.sourceExcerpt} || ' ' || ${claims.falsificationCriteria}) ILIKE ${pattern}`,
            ),
          )
          .orderBy(desc(claims.updatedAt), desc(claims.id))
          .limit(limit)
      : Promise.resolve([]),
    type === "all" || type === "evidence"
      ? db
          .select({
            id: claimEvidence.id,
            captureId: claims.captureId,
            captureTitle: captures.title,
            sourceTitle: claimEvidence.sourceTitle,
            excerpt: claimEvidence.excerpt,
            note: claimEvidence.note,
            reviewStatus: claimEvidence.reviewStatus,
            sourceCheckStatus: claimEvidence.sourceCheckStatus,
            sourceExcerptMatch: claimEvidence.sourceExcerptMatch,
            createdAt: claimEvidence.createdAt,
          })
          .from(claimEvidence)
          .innerJoin(claims, eq(claimEvidence.claimId, claims.id))
          .innerJoin(captures, eq(claims.captureId, captures.id))
          .where(
            and(
              categoryCaptureIds ? inArray(claims.captureId, categoryCaptureIds) : undefined,
              sql<boolean>`(${claimEvidence.sourceTitle} || ' ' || ${claimEvidence.excerpt} || ' ' || coalesce(${claimEvidence.note}, '')) ILIKE ${pattern}`,
            ),
          )
          .orderBy(desc(claimEvidence.createdAt), desc(claimEvidence.id))
          .limit(limit)
      : Promise.resolve([]),
    type === "all" || type === "conclusion"
      ? db
          .select({
            id: claimReviews.id,
            captureId: claims.captureId,
            captureTitle: captures.title,
            statement: claims.statement,
            rationale: claimReviews.rationale,
            limitations: claimReviews.limitations,
            assessment: claimReviews.assessment,
            reviewNumber: claimReviews.reviewNumber,
            createdAt: claimReviews.createdAt,
          })
          .from(claimReviews)
          .innerJoin(claims, eq(claimReviews.claimId, claims.id))
          .innerJoin(captures, eq(claims.captureId, captures.id))
          .where(
            and(
              categoryCaptureIds ? inArray(claims.captureId, categoryCaptureIds) : undefined,
              or(
                sql<boolean>`(${claimReviews.rationale} || ' ' || coalesce(${claimReviews.limitations}, '')) ILIKE ${pattern}`,
                sql<boolean>`(${claims.statement} || ' ' || ${claims.sourceExcerpt} || ' ' || ${claims.falsificationCriteria}) ILIKE ${pattern}`,
              ),
            ),
          )
          .orderBy(desc(claimReviews.createdAt), desc(claimReviews.id))
          .limit(limit)
      : Promise.resolve([]),
  ]);

  const categoryMap = await categoriesByCaptureIds([
    ...captureRows.map((row) => row.id),
    ...claimRows.map((row) => row.captureId),
    ...evidenceRows.map((row) => row.captureId),
    ...conclusionRows.map((row) => row.captureId),
  ]);

  groups.captures = captureRows.map((row) => ({
    id: row.id,
    type: "capture",
    captureId: row.id,
    captureTitle: row.title,
    title: row.title || "未命名记录",
    excerpt: makeSearchSnippet([row.title, row.content], query),
    status: row.status,
    categories: categoryMap.get(row.id) ?? [],
    updatedAt: row.updatedAt.toISOString(),
  }));
  groups.claims = claimRows.map((row) => ({
    id: row.id,
    type: "claim",
    captureId: row.captureId,
    captureTitle: row.captureTitle,
    title: row.statement,
    excerpt: makeSearchSnippet([row.sourceExcerpt, row.falsificationCriteria], query),
    status: row.status,
    categories: categoryMap.get(row.captureId) ?? [],
    updatedAt: row.updatedAt.toISOString(),
  }));
  groups.evidence = evidenceRows.map((row) => ({
    id: row.id,
    type: "evidence",
    captureId: row.captureId,
    captureTitle: row.captureTitle,
    title: row.sourceTitle,
    excerpt: makeSearchSnippet([row.excerpt, row.note], query),
    status: `${row.reviewStatus}/${row.sourceCheckStatus}/${row.sourceExcerptMatch === true ? "matched" : row.sourceExcerptMatch === false ? "mismatched" : "unknown"}`,
    categories: categoryMap.get(row.captureId) ?? [],
    updatedAt: row.createdAt.toISOString(),
  }));
  groups.conclusions = conclusionRows.map((row) => ({
    id: row.id,
    type: "conclusion",
    captureId: row.captureId,
    captureTitle: row.captureTitle,
    title: row.statement,
    excerpt: makeSearchSnippet([row.rationale, row.limitations], query),
    status: `${row.assessment}/v${row.reviewNumber}`,
    categories: categoryMap.get(row.captureId) ?? [],
    updatedAt: row.createdAt.toISOString(),
  }));

  const returnedCount = Object.values(groups).reduce((total, items) => total + items.length, 0);
  return { query, groups, returnedCount };
}
