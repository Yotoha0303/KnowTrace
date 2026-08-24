import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  ilike,
  inArray,
  or,
  sql,
} from "drizzle-orm";

import {
  aiProcessingRuns,
  aiSuggestions,
  captureCategories,
  captureRevisions,
  captures,
  categories,
  claimAiAudits,
  claimEvidence,
  claimEvidenceRevisions,
  claimReviewEvidence,
  claimReviews,
  claims,
  evidenceSourceChecks,
  evidenceAttachments,
  knowledgeReleases,
} from "@/server/db/schema";
import { db } from "@/server/db/client";
import {
  acceptedSuggestionPayloadSchema,
  aiSuggestionPayloadSchema,
  claimAIAuditEvidenceSnapshotSchema,
  claimAIAuditPayloadSchema,
} from "@/features/ai-processing/schema";
import { claimAuditEvidenceFingerprint } from "@/features/ai-processing/claim-audit";
import { currentDataAccessScope } from "@/features/auth/access";
import {
  canManageCapture,
  captureReadCondition,
} from "@/features/auth/resource-scope";

export type CategoryDTO = {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  captureCount: number;
  activeCaptureCount: number;
  createdById: string;
  createdByName: string;
  canManage: boolean;
};

export type CaptureListItemDTO = {
  id: string;
  title: string | null;
  subject: string | null;
  content: string;
  occurredAt: string;
  contentType:
    | "keyword_set"
    | "thought_fragment"
    | "experience"
    | "observation"
    | "question"
    | "source_note"
    | "mixed"
    | "unknown";
  status: "active" | "archived";
  visibility: "private" | "shared";
  version: number;
  createdById: string;
  createdByName: string;
  canManage: boolean;
  categories: Pick<CategoryDTO, "id" | "name">[];
  createdAt: string;
  updatedAt: string;
};

export type ClaimListItemDTO = {
  id: string;
  captureId: string;
  captureTitle: string | null;
  statement: string;
  sourceExcerpt: string;
  falsificationCriteria: string;
  status: ClaimDTO["status"];
  acceptedEvidenceCount: number;
  publishedReleaseCount: number;
  latestAssessment: null | {
    assessment: "supported" | "refuted" | "inconclusive";
    reviewNumber: number;
    rationale: string;
    createdAt: string;
  };
  createdAt: string;
  updatedAt: string;
};

export type CaptureDetailDTO = CaptureListItemDTO & {
  claims: ClaimDTO[];
  revisions: Array<{
    id: string;
    version: number;
    title: string | null;
    subject: string | null;
    content: string;
    occurredAt: string;
    contentType: CaptureListItemDTO["contentType"];
    createdAt: string;
  }>;
  aiHistory: Array<{
    id: string;
    taskType: string;
    provider: string;
    model: string;
    status: "running" | "succeeded" | "failed" | "cancelled";
    errorCode: string | null;
    latencyMs: number | null;
    createdAt: string;
    suggestion: null | {
      id: string;
      status:
        | "pending"
        | "accepted"
        | "modified"
        | "rejected"
        | "stale"
        | "rolled_back";
      sourceCaptureVersion: number;
      payload: ReturnType<typeof aiSuggestionPayloadSchema.parse>;
      acceptedPayload: ReturnType<
        typeof acceptedSuggestionPayloadSchema.parse
      > | null;
      createdAt: string;
    };
  }>;
};

export type ClaimDTO = {
  id: string;
  sourceCaptureVersion: number;
  statement: string;
  sourceExcerpt: string;
  falsificationCriteria: string;
  status:
    | "candidate"
    | "investigating"
    | "ready_for_review"
    | "concluded"
    | "withdrawn";
  createdAt: string;
  updatedAt: string;
  aiAudits: Array<{
    id: string;
    provider: string;
    model: string;
    latencyMs: number | null;
    sourceClaimUpdatedAt: string;
    evidenceCount: number;
    isStale: boolean;
    payload: ReturnType<typeof claimAIAuditPayloadSchema.parse>;
    createdAt: string;
  }>;
  reviews: Array<{
    id: string;
    reviewNumber: number;
    assessment: "supported" | "refuted" | "inconclusive";
    rationale: string;
    limitations: string | null;
    reviewerId: string;
    reviewerName: string;
    createdAt: string;
    evidenceSnapshots: Array<{
      evidenceId: string;
      sourceCheckId: string;
      stance: "supports" | "contradicts" | "context";
      sourceUrl: string;
      sourceTitle: string;
      excerpt: string;
      finalUrl: string;
      sourceContentHash: string;
      sourceCheckedAt: string;
    }>;
  }>;
  evidence: Array<{
    id: string;
    version: number;
    sourceUrl: string;
    sourceTitle: string;
    excerpt: string;
    stance: "supports" | "contradicts" | "context";
    note: string | null;
    reviewStatus: "unreviewed" | "accepted" | "rejected";
    sourceCheckStatus: "unchecked" | "passed" | "failed";
    sourceExcerptMatch: boolean | null;
    sourceCheckedAt: string | null;
    sourceCheck: null | {
      id: string;
      verificationMethod: "web" | "manual_attachment";
      finalUrl: string | null;
      status: "passed" | "failed";
      httpStatus: number | null;
      contentType: string | null;
      contentHash: string | null;
      fetchedTitle: string | null;
      excerptMatch: boolean | null;
      responseBytes: number | null;
      errorCode: string | null;
      attachmentSnapshot: Array<{
        id: string;
        originalName: string;
        mimeType: string;
        byteSize: number;
        sha256: string;
      }> | null;
      verificationNote: string | null;
      checkedAt: string;
    };
    reviewedAt: string | null;
    createdAt: string;
    revisions: Array<{
      id: string;
      version: number;
      sourceUrl: string;
      sourceTitle: string;
      excerpt: string;
      stance: "supports" | "contradicts" | "context";
      note: string | null;
      createdAt: string;
    }>;
    attachments: Array<{
      id: string;
      originalName: string;
      mimeType: string;
      byteSize: number;
      sha256: string;
      createdAt: string;
    }>;
  }>;
};

function toIso(date: Date): string {
  return date.toISOString();
}

async function categoriesByCaptureIds(captureIds: string[]) {
  if (captureIds.length === 0) return new Map<string, Array<{ id: string; name: string }>>();

  const rows = await db
    .select({
      captureId: captureCategories.captureId,
      id: categories.id,
      name: categories.name,
    })
    .from(captureCategories)
    .innerJoin(categories, eq(captureCategories.categoryId, categories.id))
    .where(inArray(captureCategories.captureId, captureIds))
    .orderBy(categories.name);

  const grouped = new Map<string, Array<{ id: string; name: string }>>();
  for (const row of rows) {
    const values = grouped.get(row.captureId) ?? [];
    values.push({ id: row.id, name: row.name });
    grouped.set(row.captureId, values);
  }
  return grouped;
}

export async function listCategories(includeArchived = false): Promise<CategoryDTO[]> {
  const scope = await currentDataAccessScope();
  const readableCaptureIds = db
    .select({ id: captures.id })
    .from(captures)
    .where(captureReadCondition(scope));
  const readableCategoryIds = db
    .select({ categoryId: captureCategories.categoryId })
    .from(captureCategories)
    .where(inArray(captureCategories.captureId, readableCaptureIds));
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      description: categories.description,
      status: categories.status,
      createdById: categories.createdById,
      createdByName: categories.createdByName,
      captureCount: countDistinct(captures.id),
      activeCaptureCount: sql<number>`count(distinct ${captures.id}) filter (where ${captures.status} = 'active')`,
    })
    .from(categories)
    .leftJoin(captureCategories, eq(categories.id, captureCategories.categoryId))
    .leftJoin(
      captures,
      and(
        eq(captures.id, captureCategories.captureId),
        captureReadCondition(scope),
      ),
    )
    .where(
      and(
        includeArchived ? undefined : eq(categories.status, "active"),
        scope.isAdmin
          ? undefined
          : or(
              eq(categories.createdById, scope.actorId),
              inArray(categories.id, readableCategoryIds),
            ),
      ),
    )
    .groupBy(categories.id)
    .orderBy(categories.name);

  return rows.map((row) => ({
    ...row,
    captureCount: Number(row.captureCount),
    activeCaptureCount: Number(row.activeCaptureCount),
    canManage: scope.isAdmin || row.createdById === scope.actorId,
  }));
}

export async function listCaptures(options?: {
  status?: "active" | "archived";
  categoryId?: string;
  limit?: number;
  offset?: number;
}): Promise<CaptureListItemDTO[]> {
  const scope = await currentDataAccessScope();
  const status = options?.status ?? "active";
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);
  const offset = Math.min(Math.max(options?.offset ?? 0, 0), 25_000);
  const categoryFilter = options?.categoryId
    ? db
        .select({ captureId: captureCategories.captureId })
        .from(captureCategories)
        .where(eq(captureCategories.categoryId, options.categoryId))
    : undefined;

  const rows = await db
    .select()
    .from(captures)
    .where(
      and(
        eq(captures.status, status),
        categoryFilter ? inArray(captures.id, categoryFilter) : undefined,
        captureReadCondition(scope),
      ),
    )
    .orderBy(desc(captures.createdAt), desc(captures.id))
    .limit(limit)
    .offset(offset);

  const groupedCategories = await categoriesByCaptureIds(rows.map((row) => row.id));
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    subject: row.subject,
    content: row.content,
    occurredAt: toIso(row.occurredAt),
    contentType: row.contentType,
    status: row.status,
    visibility: row.visibility,
    version: row.version,
    createdById: row.createdById,
    createdByName: row.createdByName,
    canManage: canManageCapture(scope, row.createdById),
    categories: groupedCategories.get(row.id) ?? [],
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  }));
}

export async function listClaims(options?: {
  query?: string;
  status?: ClaimDTO["status"];
  limit?: number;
  offset?: number;
}): Promise<ClaimListItemDTO[]> {
  const scope = await currentDataAccessScope();
  const query = options?.query?.trim().slice(0, 100) ?? "";
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);
  const offset = Math.min(Math.max(options?.offset ?? 0, 0), 25_000);
  const rows = await db
    .select({
      claim: claims,
      captureTitle: captures.title,
    })
    .from(claims)
    .innerJoin(captures, eq(claims.captureId, captures.id))
    .where(
      and(
        options?.status ? eq(claims.status, options.status) : undefined,
        captureReadCondition(scope),
        query
          ? or(
              ilike(claims.statement, `%${query}%`),
              ilike(claims.sourceExcerpt, `%${query}%`),
              ilike(captures.title, `%${query}%`),
            )
          : undefined,
      ),
    )
    .orderBy(desc(claims.updatedAt), desc(claims.id))
    .limit(limit)
    .offset(offset);
  if (!rows.length) return [];

  const claimIds = rows.map(({ claim }) => claim.id);
  const [evidenceCounts, reviewRows, releaseCounts] = await Promise.all([
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
    db
      .select()
      .from(claimReviews)
      .where(inArray(claimReviews.claimId, claimIds))
      .orderBy(desc(claimReviews.reviewNumber)),
    db
      .select({ claimId: knowledgeReleases.claimId, value: count() })
      .from(knowledgeReleases)
      .where(inArray(knowledgeReleases.claimId, claimIds))
      .groupBy(knowledgeReleases.claimId),
  ]);
  const evidenceCountByClaimId = new Map(
    evidenceCounts.map((item) => [item.claimId, Number(item.value)]),
  );
  const latestReviewByClaimId = new Map<string, (typeof reviewRows)[number]>();
  const releaseCountByClaimId = new Map(
    releaseCounts.map((item) => [item.claimId, Number(item.value)]),
  );
  for (const review of reviewRows) {
    if (!latestReviewByClaimId.has(review.claimId)) {
      latestReviewByClaimId.set(review.claimId, review);
    }
  }

  return rows.map(({ claim, captureTitle }) => {
    const review = latestReviewByClaimId.get(claim.id);
    return {
      id: claim.id,
      captureId: claim.captureId,
      captureTitle,
      statement: claim.statement,
      sourceExcerpt: claim.sourceExcerpt,
      falsificationCriteria: claim.falsificationCriteria,
      status: claim.status,
      acceptedEvidenceCount: evidenceCountByClaimId.get(claim.id) ?? 0,
      publishedReleaseCount: releaseCountByClaimId.get(claim.id) ?? 0,
      latestAssessment: review
        ? {
            assessment: review.assessment,
            reviewNumber: review.reviewNumber,
            rationale: review.rationale,
            createdAt: toIso(review.createdAt),
          }
        : null,
      createdAt: toIso(claim.createdAt),
      updatedAt: toIso(claim.updatedAt),
    };
  });
}

export async function getCaptureDetail(id: string): Promise<CaptureDetailDTO | null> {
  const scope = await currentDataAccessScope();
  const [row] = await db
    .select()
    .from(captures)
    .where(
      and(
        eq(captures.id, id),
        captureReadCondition(scope),
      ),
    )
    .limit(1);
  if (!row) return null;

  const [groupedCategories, revisions, historyRows, claimRows] = await Promise.all([
    categoriesByCaptureIds([id]),
    db
      .select()
      .from(captureRevisions)
      .where(eq(captureRevisions.captureId, id))
      .orderBy(desc(captureRevisions.version))
      .limit(20),
    db
      .select({ run: aiProcessingRuns, suggestion: aiSuggestions })
      .from(aiProcessingRuns)
      .leftJoin(
        aiSuggestions,
        eq(aiProcessingRuns.id, aiSuggestions.processingRunId),
      )
      .where(eq(aiProcessingRuns.captureId, id))
      .orderBy(desc(aiProcessingRuns.createdAt))
      .limit(20),
    db
      .select()
      .from(claims)
      .where(eq(claims.captureId, id))
      .orderBy(desc(claims.createdAt)),
  ]);
  const [evidenceRows, reviewRows, auditRows] = claimRows.length
    ? await Promise.all([
        db
          .select()
          .from(claimEvidence)
          .where(inArray(claimEvidence.claimId, claimRows.map((claim) => claim.id)))
          .orderBy(desc(claimEvidence.createdAt)),
        db
          .select()
          .from(claimReviews)
          .where(inArray(claimReviews.claimId, claimRows.map((claim) => claim.id)))
          .orderBy(desc(claimReviews.reviewNumber)),
        db
          .select({ audit: claimAiAudits, run: aiProcessingRuns })
          .from(claimAiAudits)
          .innerJoin(
            aiProcessingRuns,
            eq(claimAiAudits.processingRunId, aiProcessingRuns.id),
          )
          .where(inArray(claimAiAudits.claimId, claimRows.map((claim) => claim.id)))
          .orderBy(desc(claimAiAudits.createdAt)),
      ])
    : [[], [], []];
  const evidenceByClaimId = new Map<string, typeof evidenceRows>();
  for (const evidence of evidenceRows) {
    const values = evidenceByClaimId.get(evidence.claimId) ?? [];
    values.push(evidence);
    evidenceByClaimId.set(evidence.claimId, values);
  }
  const sourceCheckIds = evidenceRows
    .map((evidence) => evidence.latestSourceCheckId)
    .filter((id): id is string => Boolean(id));
  const [sourceCheckRows, reviewEvidenceRows, evidenceRevisionRows, attachmentRows] = await Promise.all([
    sourceCheckIds.length
      ? db
          .select()
          .from(evidenceSourceChecks)
          .where(inArray(evidenceSourceChecks.id, sourceCheckIds))
      : [],
    reviewRows.length
      ? db
          .select()
          .from(claimReviewEvidence)
          .where(
            inArray(
              claimReviewEvidence.reviewId,
              reviewRows.map((review) => review.id),
            ),
          )
      : [],
    evidenceRows.length
      ? db
          .select()
          .from(claimEvidenceRevisions)
          .where(
            inArray(
              claimEvidenceRevisions.evidenceId,
              evidenceRows.map((evidence) => evidence.id),
            ),
          )
          .orderBy(desc(claimEvidenceRevisions.version))
      : [],
    evidenceRows.length
      ? db
          .select()
          .from(evidenceAttachments)
          .where(
            inArray(
              evidenceAttachments.evidenceId,
              evidenceRows.map((evidence) => evidence.id),
            ),
          )
          .orderBy(desc(evidenceAttachments.createdAt))
      : [],
  ]);
  const sourceCheckById = new Map(
    sourceCheckRows.map((sourceCheck) => [sourceCheck.id, sourceCheck]),
  );
  const revisionsByEvidenceId = new Map<string, typeof evidenceRevisionRows>();
  for (const revision of evidenceRevisionRows) {
    const values = revisionsByEvidenceId.get(revision.evidenceId) ?? [];
    values.push(revision);
    revisionsByEvidenceId.set(revision.evidenceId, values);
  }
  const attachmentsByEvidenceId = new Map<string, typeof attachmentRows>();
  for (const attachment of attachmentRows) {
    const values = attachmentsByEvidenceId.get(attachment.evidenceId) ?? [];
    values.push(attachment);
    attachmentsByEvidenceId.set(attachment.evidenceId, values);
  }
  const reviewsByClaimId = new Map<string, typeof reviewRows>();
  for (const review of reviewRows) {
    const values = reviewsByClaimId.get(review.claimId) ?? [];
    values.push(review);
    reviewsByClaimId.set(review.claimId, values);
  }
  const reviewEvidenceByReviewId = new Map<string, typeof reviewEvidenceRows>();
  for (const snapshot of reviewEvidenceRows) {
    const values = reviewEvidenceByReviewId.get(snapshot.reviewId) ?? [];
    values.push(snapshot);
    reviewEvidenceByReviewId.set(snapshot.reviewId, values);
  }
  const auditsByClaimId = new Map<string, typeof auditRows>();
  for (const audit of auditRows) {
    const values = auditsByClaimId.get(audit.audit.claimId) ?? [];
    values.push(audit);
    auditsByClaimId.set(audit.audit.claimId, values);
  }

  return {
    id: row.id,
    title: row.title,
    subject: row.subject,
    content: row.content,
    occurredAt: toIso(row.occurredAt),
    contentType: row.contentType,
    status: row.status,
    visibility: row.visibility,
    version: row.version,
    createdById: row.createdById,
    createdByName: row.createdByName,
    canManage: canManageCapture(scope, row.createdById),
    categories: groupedCategories.get(row.id) ?? [],
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    claims: claimRows.map((claim) => {
      const currentEvidence = (evidenceByClaimId.get(claim.id) ?? []).flatMap(
        (evidence) => {
          const sourceCheck = evidence.latestSourceCheckId
            ? sourceCheckById.get(evidence.latestSourceCheckId)
            : null;
          return evidence.reviewStatus === "accepted" &&
            evidence.sourceCheckStatus === "passed" &&
            evidence.sourceExcerptMatch === true &&
            sourceCheck?.status === "passed" &&
            sourceCheck.excerptMatch === true &&
            sourceCheck.finalUrl &&
            sourceCheck.contentHash
            ? [
                {
                  id: evidence.id,
                  stance: evidence.stance,
                  sourceUrl: evidence.sourceUrl,
                  sourceTitle: evidence.sourceTitle,
                  excerpt: evidence.excerpt,
                  note: evidence.note,
                  sourceCheckId: sourceCheck.id,
                  verificationMethod: sourceCheck.verificationMethod,
                  finalUrl: sourceCheck.finalUrl,
                  contentHash: sourceCheck.contentHash,
                  sourceCheckedAt: toIso(sourceCheck.checkedAt),
                },
              ]
            : [];
        },
      );
      const currentEvidenceFingerprint = claimAuditEvidenceFingerprint(currentEvidence);
      return {
      id: claim.id,
      sourceCaptureVersion: claim.sourceCaptureVersion,
      statement: claim.statement,
      sourceExcerpt: claim.sourceExcerpt,
      falsificationCriteria: claim.falsificationCriteria,
      status: claim.status,
      createdAt: toIso(claim.createdAt),
      updatedAt: toIso(claim.updatedAt),
      aiAudits: (auditsByClaimId.get(claim.id) ?? []).map(({ audit, run }) => ({
        id: audit.id,
        provider: run.provider,
        model: run.model,
        latencyMs: run.latencyMs,
        sourceClaimUpdatedAt: toIso(audit.sourceClaimUpdatedAt),
        evidenceCount: claimAIAuditEvidenceSnapshotSchema.parse(
          audit.evidenceSnapshot,
        ).length,
        isStale:
          audit.sourceClaimUpdatedAt.getTime() !== claim.updatedAt.getTime() ||
          audit.sourceEvidenceFingerprint !== currentEvidenceFingerprint,
        payload: claimAIAuditPayloadSchema.parse(audit.payload),
        createdAt: toIso(audit.createdAt),
      })),
      reviews: (reviewsByClaimId.get(claim.id) ?? []).map((review) => ({
        id: review.id,
        reviewNumber: review.reviewNumber,
        assessment: review.assessment,
        rationale: review.rationale,
        limitations: review.limitations,
        reviewerId: review.reviewerId,
        reviewerName: review.reviewerName,
        createdAt: toIso(review.createdAt),
        evidenceSnapshots: (reviewEvidenceByReviewId.get(review.id) ?? []).map(
          (snapshot) => ({
            evidenceId: snapshot.evidenceId,
            sourceCheckId: snapshot.sourceCheckId,
            stance: snapshot.stance,
            sourceUrl: snapshot.sourceUrl,
            sourceTitle: snapshot.sourceTitle,
            excerpt: snapshot.excerpt,
            finalUrl: snapshot.finalUrl,
            sourceContentHash: snapshot.sourceContentHash,
            sourceCheckedAt: toIso(snapshot.sourceCheckedAt),
          }),
        ),
      })),
      evidence: (evidenceByClaimId.get(claim.id) ?? []).map((evidence) => ({
        sourceCheck: evidence.latestSourceCheckId
          ? (() => {
              const sourceCheck = sourceCheckById.get(evidence.latestSourceCheckId);
              return sourceCheck
                ? {
                    id: sourceCheck.id,
                    verificationMethod: sourceCheck.verificationMethod,
                    finalUrl: sourceCheck.finalUrl,
                    status: sourceCheck.status,
                    httpStatus: sourceCheck.httpStatus,
                    contentType: sourceCheck.contentType,
                    contentHash: sourceCheck.contentHash,
                    fetchedTitle: sourceCheck.fetchedTitle,
                    excerptMatch: sourceCheck.excerptMatch,
                    responseBytes: sourceCheck.responseBytes,
                    errorCode: sourceCheck.errorCode,
                    attachmentSnapshot: sourceCheck.attachmentSnapshot,
                    verificationNote: sourceCheck.verificationNote,
                    checkedAt: toIso(sourceCheck.checkedAt),
                  }
                : null;
            })()
          : null,
        id: evidence.id,
        version: evidence.version,
        sourceUrl: evidence.sourceUrl,
        sourceTitle: evidence.sourceTitle,
        excerpt: evidence.excerpt,
        stance: evidence.stance,
        note: evidence.note,
        reviewStatus: evidence.reviewStatus,
        sourceCheckStatus: evidence.sourceCheckStatus,
        sourceExcerptMatch: evidence.sourceExcerptMatch,
        sourceCheckedAt: evidence.sourceCheckedAt
          ? toIso(evidence.sourceCheckedAt)
          : null,
        reviewedAt: evidence.reviewedAt ? toIso(evidence.reviewedAt) : null,
        createdAt: toIso(evidence.createdAt),
        revisions: (revisionsByEvidenceId.get(evidence.id) ?? []).map((revision) => ({
          id: revision.id,
          version: revision.version,
          sourceUrl: revision.sourceUrl,
          sourceTitle: revision.sourceTitle,
          excerpt: revision.excerpt,
          stance: revision.stance,
          note: revision.note,
          createdAt: toIso(revision.createdAt),
        })),
        attachments: (attachmentsByEvidenceId.get(evidence.id) ?? []).map((attachment) => ({
          id: attachment.id,
          originalName: attachment.originalName,
          mimeType: attachment.mimeType,
          byteSize: attachment.byteSize,
          sha256: attachment.sha256,
          createdAt: toIso(attachment.createdAt),
        })),
      })),
    };
    }),
    revisions: revisions.map((revision) => ({
      id: revision.id,
      version: revision.version,
      title: revision.title,
      subject: revision.subject,
      content: revision.content,
      occurredAt: toIso(revision.occurredAt),
      contentType: revision.contentType,
      createdAt: toIso(revision.createdAt),
    })),
    aiHistory: historyRows.map(({ run, suggestion }) => ({
      id: run.id,
      taskType: run.taskType,
      provider: run.provider,
      model: run.model,
      status: run.status,
      errorCode: run.errorCode,
      latencyMs: run.latencyMs,
      createdAt: toIso(run.createdAt),
      suggestion: suggestion
        ? {
            id: suggestion.id,
            status: suggestion.status,
            sourceCaptureVersion: suggestion.sourceCaptureVersion,
            payload: aiSuggestionPayloadSchema.parse(suggestion.payload),
            acceptedPayload: suggestion.acceptedPayload
              ? acceptedSuggestionPayloadSchema.safeParse(
                  suggestion.acceptedPayload,
                ).data ?? null
              : null,
            createdAt: toIso(suggestion.createdAt),
          }
        : null,
    })),
  };
}
