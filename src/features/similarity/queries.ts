import "server-only";

import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";

import type { CaptureListItemDTO } from "@/features/capture/queries";
import { db } from "@/server/db/client";
import {
  captureCategories,
  captures,
  categories,
} from "@/server/db/schema";

import { rankSimilarCapture } from "./ranking";
import { currentDataAccessScope } from "@/features/auth/access";

const TEXT_CANDIDATE_LIMIT = 24;
const CONTEXT_CANDIDATE_LIMIT = 24;

export type SimilarCaptureDTO = CaptureListItemDTO & {
  score: number;
  textSimilarity: number;
  sameSubject: boolean;
  sharedCategories: Array<{ id: string; name: string }>;
  reasons: string[];
};

function searchableCaptureText(capture: {
  title: string | null;
  subject: string | null;
  content: string;
}) {
  return [capture.title, capture.subject, capture.content]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
}

export async function findSimilarCaptures(
  captureId: string,
  requestedLimit = 5,
): Promise<SimilarCaptureDTO[]> {
  const scope = await currentDataAccessScope();
  const limit = Math.min(Math.max(Math.trunc(requestedLimit), 1), 8);
  const [[source], sourceCategoryRows] = await Promise.all([
    db
      .select({
        id: captures.id,
        title: captures.title,
        subject: captures.subject,
        content: captures.content,
      })
      .from(captures)
      .where(
        and(
          eq(captures.id, captureId),
          scope.isAdmin ? undefined : eq(captures.createdById, scope.actorId),
        ),
      )
      .limit(1),
    db
      .select({ id: categories.id, name: categories.name })
      .from(captureCategories)
      .innerJoin(categories, eq(captureCategories.categoryId, categories.id))
      .where(eq(captureCategories.captureId, captureId))
      .orderBy(categories.name),
  ]);
  if (!source) return [];

  const sourceText = searchableCaptureText(source);
  if (!sourceText) return [];

  const candidateText = sql<string>`(coalesce(${captures.title}, '') || ' ' || coalesce(${captures.subject}, '') || ' ' || ${captures.content})`;
  const textSimilarity = sql<number>`similarity(${candidateText}, ${sourceText})`;
  const textDistance = sql<number>`${candidateText} <-> ${sourceText}`;
  const selection = {
    id: captures.id,
    title: captures.title,
    subject: captures.subject,
    content: captures.content,
    occurredAt: captures.occurredAt,
    contentType: captures.contentType,
    status: captures.status,
    version: captures.version,
    createdById: captures.createdById,
    createdByName: captures.createdByName,
    createdAt: captures.createdAt,
    updatedAt: captures.updatedAt,
    textSimilarity: textSimilarity.as("text_similarity"),
  };
  const normalizedSubject = source.subject?.trim() ?? "";
  const sameSubjectCondition = normalizedSubject
    ? sql<boolean>`lower(trim(coalesce(${captures.subject}, ''))) = lower(${normalizedSubject})`
    : undefined;
  const categoryCaptureIds = sourceCategoryRows.length
    ? db
        .select({ captureId: captureCategories.captureId })
        .from(captureCategories)
        .where(
          inArray(
            captureCategories.categoryId,
            sourceCategoryRows.map((category) => category.id),
          ),
        )
    : undefined;
  const contextCondition = or(
    sameSubjectCondition,
    categoryCaptureIds
      ? inArray(captures.id, categoryCaptureIds)
      : undefined,
  );

  const [textRows, contextRows] = await Promise.all([
    db
      .select(selection)
      .from(captures)
      .where(
        and(
          ne(captures.id, captureId),
          scope.isAdmin ? undefined : eq(captures.createdById, scope.actorId),
        ),
      )
      .orderBy(textDistance, desc(captures.updatedAt), desc(captures.id))
      .limit(TEXT_CANDIDATE_LIMIT),
    contextCondition
      ? db
          .select(selection)
          .from(captures)
          .where(
            and(
              ne(captures.id, captureId),
              contextCondition,
              scope.isAdmin ? undefined : eq(captures.createdById, scope.actorId),
            ),
          )
          .orderBy(desc(textSimilarity), desc(captures.updatedAt), desc(captures.id))
          .limit(CONTEXT_CANDIDATE_LIMIT)
      : Promise.resolve([]),
  ]);
  const candidateById = new Map(
    [...textRows, ...contextRows].map((candidate) => [candidate.id, candidate]),
  );
  if (!candidateById.size) return [];

  const candidateIds = [...candidateById.keys()];
  const candidateCategoryRows = await db
    .select({
      captureId: captureCategories.captureId,
      id: categories.id,
      name: categories.name,
    })
    .from(captureCategories)
    .innerJoin(categories, eq(captureCategories.categoryId, categories.id))
    .where(inArray(captureCategories.captureId, candidateIds))
    .orderBy(categories.name);
  const categoriesByCaptureId = new Map<
    string,
    Array<{ id: string; name: string }>
  >();
  for (const category of candidateCategoryRows) {
    const values = categoriesByCaptureId.get(category.captureId) ?? [];
    values.push({ id: category.id, name: category.name });
    categoriesByCaptureId.set(category.captureId, values);
  }

  const sourceCategoryIds = new Set(
    sourceCategoryRows.map((category) => category.id),
  );
  const normalizedSourceSubject = normalizedSubject.toLocaleLowerCase("zh-CN");

  return [...candidateById.values()]
    .flatMap((candidate) => {
      const candidateCategories = categoriesByCaptureId.get(candidate.id) ?? [];
      const sharedCategories = candidateCategories.filter((category) =>
        sourceCategoryIds.has(category.id),
      );
      const sameSubject = Boolean(
        normalizedSourceSubject &&
        candidate.subject?.trim().toLocaleLowerCase("zh-CN") ===
          normalizedSourceSubject,
      );
      const rank = rankSimilarCapture({
        textSimilarity: Number(candidate.textSimilarity),
        sameSubject,
        sharedCategoryCount: sharedCategories.length,
      });
      if (!rank.qualifies) return [];

      const reasons: string[] = [];
      if (sameSubject) reasons.push("同一描述对象");
      if (sharedCategories.length) {
        reasons.push(
          `共同分类：${sharedCategories.slice(0, 2).map((category) => category.name).join("、")}`,
        );
      }
      if (rank.textSimilarity >= 0.05) {
        reasons.push(`文字相似 ${Math.round(rank.textSimilarity * 100)}%`);
      }

      return [{
        id: candidate.id,
        title: candidate.title,
        subject: candidate.subject,
        content: candidate.content,
        occurredAt: candidate.occurredAt.toISOString(),
        contentType: candidate.contentType,
        status: candidate.status,
        version: candidate.version,
        createdById: candidate.createdById,
        createdByName: candidate.createdByName,
        categories: candidateCategories,
        createdAt: candidate.createdAt.toISOString(),
        updatedAt: candidate.updatedAt.toISOString(),
        score: rank.score,
        textSimilarity: rank.textSimilarity,
        sameSubject,
        sharedCategories,
        reasons,
      } satisfies SimilarCaptureDTO];
    })
    .sort((left, right) =>
      right.score - left.score ||
      right.updatedAt.localeCompare(left.updatedAt),
    )
    .slice(0, limit);
}
