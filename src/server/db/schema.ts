import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const contentTypeEnum = pgEnum("content_type", [
  "keyword_set",
  "thought_fragment",
  "experience",
  "observation",
  "question",
  "source_note",
  "mixed",
  "unknown",
]);

export const recordStatusEnum = pgEnum("record_status", [
  "active",
  "archived",
]);

export const categoryAssignedByEnum = pgEnum("category_assigned_by", [
  "manual",
  "ai_accepted",
]);

export const aiRunStatusEnum = pgEnum("ai_run_status", [
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

export const dataImportStatusEnum = pgEnum("data_import_status", [
  "previewed",
  "importing",
  "completed",
  "failed",
]);

export const suggestionStatusEnum = pgEnum("suggestion_status", [
  "pending",
  "accepted",
  "modified",
  "rejected",
  "stale",
  "rolled_back",
]);

export const topicSynthesisDecisionEnum = pgEnum(
  "topic_synthesis_decision",
  ["pending", "accepted", "rejected"],
);

export const claimStatusEnum = pgEnum("claim_status", [
  "candidate",
  "investigating",
  "ready_for_review",
  "concluded",
  "withdrawn",
]);

export const claimAssessmentEnum = pgEnum("claim_assessment", [
  "supported",
  "refuted",
  "inconclusive",
]);

export const evidenceStanceEnum = pgEnum("evidence_stance", [
  "supports",
  "contradicts",
  "context",
]);

export const evidenceReviewStatusEnum = pgEnum("evidence_review_status", [
  "unreviewed",
  "accepted",
  "rejected",
]);

export const evidenceSourceCheckStatusEnum = pgEnum(
  "evidence_source_check_status",
  ["unchecked", "passed", "failed"],
);

export const sourceCheckAttemptStatusEnum = pgEnum(
  "source_check_attempt_status",
  ["passed", "failed"],
);

export const evidenceVerificationMethodEnum = pgEnum(
  "evidence_verification_method",
  ["web", "manual_attachment"],
);

export const sourceAuthorityLevelEnum = pgEnum("source_authority_level", [
  "primary",
  "official",
  "expert",
  "secondary",
  "community",
  "unknown",
]);

export const independentReviewDecisionEnum = pgEnum(
  "independent_review_decision",
  ["approved", "changes_requested"],
);

export type EvidenceAttachmentVerificationSnapshot = Array<{
  id: string;
  originalName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
}>;

export const captures = pgTable(
  "captures",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: varchar("title", { length: 200 }),
    subject: varchar("subject", { length: 200 }),
    content: text("content").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    contentType: contentTypeEnum("content_type").notNull().default("unknown"),
    status: recordStatusEnum("status").notNull().default("active"),
    version: integer("version").notNull().default(1),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    idempotencyHash: varchar("idempotency_hash", { length: 64 }).notNull(),
    createdById: varchar("created_by_id", { length: 100 })
      .notNull()
      .default("legacy-local"),
    createdByName: varchar("created_by_name", { length: 255 })
      .notNull()
      .default("本地历史数据"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("captures_creator_idempotency_key_uq").on(
      table.createdById,
      table.idempotencyKey,
    ),
    index("captures_creator_status_created_idx").on(
      table.createdById,
      table.status,
      table.createdAt,
      table.id,
    ),
    index("captures_status_created_idx").on(
      table.status,
      table.createdAt,
      table.id,
    ),
    index("captures_occurred_idx").on(table.occurredAt, table.id),
    check(
      "captures_content_length_chk",
      sql`char_length(${table.content}) between 1 and 20000`,
    ),
    check("captures_version_chk", sql`${table.version} > 0`),
  ],
);

export const captureRevisions = pgTable(
  "capture_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    captureId: uuid("capture_id")
      .notNull()
      .references(() => captures.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    title: varchar("title", { length: 200 }),
    subject: varchar("subject", { length: 200 }),
    content: text("content").notNull(),
    contentType: contentTypeEnum("content_type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("capture_revisions_capture_version_uq").on(
      table.captureId,
      table.version,
    ),
    index("capture_revisions_capture_idx").on(
      table.captureId,
      table.version,
    ),
  ],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 60 }).notNull(),
    normalizedName: varchar("normalized_name", { length: 80 }).notNull(),
    description: varchar("description", { length: 500 }),
    status: recordStatusEnum("status").notNull().default("active"),
    createdById: varchar("created_by_id", { length: 100 })
      .notNull()
      .default("legacy-local"),
    createdByName: varchar("created_by_name", { length: 255 })
      .notNull()
      .default("本地历史数据"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("categories_creator_normalized_name_uq").on(
      table.createdById,
      table.normalizedName,
    ),
    index("categories_creator_status_name_idx").on(
      table.createdById,
      table.status,
      table.name,
    ),
    index("categories_status_name_idx").on(table.status, table.name),
  ],
);

export const captureCategories = pgTable(
  "capture_categories",
  {
    captureId: uuid("capture_id")
      .notNull()
      .references(() => captures.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    assignedBy: categoryAssignedByEnum("assigned_by")
      .notNull()
      .default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.captureId, table.categoryId] }),
    index("capture_categories_category_idx").on(
      table.categoryId,
      table.captureId,
    ),
  ],
);

export const aiProcessingRuns = pgTable(
  "ai_processing_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    captureId: uuid("capture_id")
      .notNull()
      .references(() => captures.id, { onDelete: "cascade" }),
    captureVersion: integer("capture_version").notNull(),
    inputHash: varchar("input_hash", { length: 64 }).notNull(),
    taskType: varchar("task_type", { length: 40 }).notNull().default("organize"),
    provider: varchar("provider", { length: 40 }).notNull(),
    model: varchar("model", { length: 80 }).notNull(),
    promptVersion: varchar("prompt_version", { length: 40 }).notNull(),
    schemaVersion: varchar("schema_version", { length: 40 }).notNull(),
    status: aiRunStatusEnum("status").notNull().default("running"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    latencyMs: integer("latency_ms"),
    errorCode: varchar("error_code", { length: 80 }),
    requestId: varchar("request_id", { length: 80 }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("ai_runs_capture_created_idx").on(
      table.captureId,
      table.createdAt,
    ),
    index("ai_runs_status_started_idx").on(table.status, table.startedAt),
  ],
);

export const aiSuggestions = pgTable(
  "ai_suggestions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    processingRunId: uuid("processing_run_id")
      .notNull()
      .references(() => aiProcessingRuns.id, { onDelete: "cascade" }),
    captureId: uuid("capture_id")
      .notNull()
      .references(() => captures.id, { onDelete: "cascade" }),
    sourceCaptureVersion: integer("source_capture_version").notNull(),
    schemaVersion: varchar("schema_version", { length: 40 }).notNull(),
    payload: jsonb("payload").notNull(),
    status: suggestionStatusEnum("status").notNull().default("pending"),
    acceptedPayload: jsonb("accepted_payload"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("ai_suggestions_run_uq").on(table.processingRunId),
    index("ai_suggestions_capture_created_idx").on(
      table.captureId,
      table.createdAt,
    ),
  ],
);

export const claims = pgTable(
  "claims",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    captureId: uuid("capture_id")
      .notNull()
      .references(() => captures.id, { onDelete: "cascade" }),
    sourceSuggestionId: uuid("source_suggestion_id").references(
      () => aiSuggestions.id,
      { onDelete: "set null" },
    ),
    sourceCaptureVersion: integer("source_capture_version").notNull(),
    statement: varchar("statement", { length: 1_000 }).notNull(),
    statementHash: varchar("statement_hash", { length: 64 }).notNull(),
    sourceExcerpt: varchar("source_excerpt", { length: 1_000 }).notNull(),
    falsificationCriteria: varchar("falsification_criteria", {
      length: 1_000,
    }).notNull(),
    status: claimStatusEnum("status").notNull().default("candidate"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("claims_statement_hash_uq").on(table.statementHash),
    index("claims_capture_created_idx").on(table.captureId, table.createdAt),
    index("claims_status_updated_idx").on(table.status, table.updatedAt),
    check(
      "claims_source_version_chk",
      sql`${table.sourceCaptureVersion} > 0`,
    ),
  ],
);

export const claimEvidence = pgTable(
  "claim_evidence",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    sourceUrl: varchar("source_url", { length: 2_000 }).notNull(),
    sourceTitle: varchar("source_title", { length: 300 }).notNull(),
    excerpt: varchar("excerpt", { length: 2_000 }).notNull(),
    stance: evidenceStanceEnum("stance").notNull(),
    note: varchar("note", { length: 1_000 }),
    version: integer("version").notNull().default(1),
    reviewStatus: evidenceReviewStatusEnum("review_status")
      .notNull()
      .default("unreviewed"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    sourceCheckStatus: evidenceSourceCheckStatusEnum("source_check_status")
      .notNull()
      .default("unchecked"),
    sourceExcerptMatch: boolean("source_excerpt_match"),
    sourceCheckedAt: timestamp("source_checked_at", { withTimezone: true }),
    latestSourceCheckId: uuid("latest_source_check_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("claim_evidence_claim_created_idx").on(table.claimId, table.createdAt),
    index("claim_evidence_review_idx").on(table.reviewStatus, table.createdAt),
    index("claim_evidence_source_check_idx").on(
      table.sourceCheckStatus,
      table.sourceCheckedAt,
    ),
    check("claim_evidence_version_chk", sql`${table.version} > 0`),
    check(
      "claim_evidence_source_check_consistency_chk",
      sql`(
        (${table.sourceCheckStatus} = 'unchecked' AND ${table.sourceCheckedAt} IS NULL AND ${table.sourceExcerptMatch} IS NULL AND ${table.latestSourceCheckId} IS NULL)
        OR (${table.sourceCheckStatus} = 'failed' AND ${table.sourceCheckedAt} IS NOT NULL AND ${table.sourceExcerptMatch} IS NULL AND ${table.latestSourceCheckId} IS NOT NULL)
        OR (${table.sourceCheckStatus} = 'passed' AND ${table.sourceCheckedAt} IS NOT NULL AND ${table.sourceExcerptMatch} IS NOT NULL AND ${table.latestSourceCheckId} IS NOT NULL)
      )`,
    ),
  ],
);

export const claimEvidenceRevisions = pgTable(
  "claim_evidence_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => claimEvidence.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    sourceUrl: varchar("source_url", { length: 2_000 }).notNull(),
    sourceTitle: varchar("source_title", { length: 300 }).notNull(),
    excerpt: varchar("excerpt", { length: 2_000 }).notNull(),
    stance: evidenceStanceEnum("stance").notNull(),
    note: varchar("note", { length: 1_000 }),
    latestSourceCheckId: uuid("latest_source_check_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("claim_evidence_revisions_evidence_version_uq").on(
      table.evidenceId,
      table.version,
    ),
    index("claim_evidence_revisions_evidence_idx").on(
      table.evidenceId,
      table.version,
    ),
    check("claim_evidence_revisions_version_chk", sql`${table.version} > 0`),
  ],
);

export const evidenceAttachments = pgTable(
  "evidence_attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => claimEvidence.id, { onDelete: "cascade" }),
    originalName: varchar("original_name", { length: 255 }).notNull(),
    storagePath: varchar("storage_path", { length: 255 }).notNull(),
    mimeType: varchar("mime_type", { length: 40 }).notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("evidence_attachments_storage_path_uq").on(table.storagePath),
    index("evidence_attachments_evidence_created_idx").on(
      table.evidenceId,
      table.createdAt,
    ),
    check(
      "evidence_attachments_byte_size_chk",
      sql`${table.byteSize} between 1 and 10485760`,
    ),
    check(
      "evidence_attachments_mime_type_chk",
      sql`${table.mimeType} in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')`,
    ),
  ],
);

export const evidenceSourceChecks = pgTable(
  "evidence_source_checks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => claimEvidence.id, { onDelete: "cascade" }),
    verificationMethod: evidenceVerificationMethodEnum("verification_method")
      .notNull()
      .default("web"),
    requestedUrl: varchar("requested_url", { length: 2_000 }).notNull(),
    finalUrl: varchar("final_url", { length: 2_000 }),
    status: sourceCheckAttemptStatusEnum("status").notNull(),
    httpStatus: integer("http_status"),
    contentType: varchar("content_type", { length: 120 }),
    contentHash: varchar("content_hash", { length: 64 }),
    fetchedTitle: varchar("fetched_title", { length: 300 }),
    excerptMatch: boolean("excerpt_match"),
    responseBytes: integer("response_bytes"),
    errorCode: varchar("error_code", { length: 80 }),
    attachmentSnapshot: jsonb("attachment_snapshot")
      .$type<EvidenceAttachmentVerificationSnapshot>(),
    verificationNote: varchar("verification_note", { length: 1_000 }),
    checkedAt: timestamp("checked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("evidence_source_checks_evidence_checked_idx").on(
      table.evidenceId,
      table.checkedAt,
    ),
    check(
      "evidence_source_checks_result_consistency_chk",
      sql`(
        (
          ${table.verificationMethod} = 'web'
          AND ${table.attachmentSnapshot} IS NULL
          AND ${table.verificationNote} IS NULL
          AND (
            (${table.status} = 'passed' AND ${table.finalUrl} IS NOT NULL AND ${table.httpStatus} IS NOT NULL AND ${table.contentHash} IS NOT NULL AND ${table.excerptMatch} IS NOT NULL AND ${table.responseBytes} IS NOT NULL AND ${table.errorCode} IS NULL)
            OR (${table.status} = 'failed' AND ${table.errorCode} IS NOT NULL)
          )
        )
        OR (
          ${table.verificationMethod} = 'manual_attachment'
          AND ${table.status} = 'passed'
          AND ${table.requestedUrl} = ''
          AND ${table.finalUrl} IS NOT NULL
          AND ${table.httpStatus} IS NULL
          AND ${table.contentType} = 'application/vnd.knowtrace.evidence-attachments+json'
          AND ${table.contentHash} IS NOT NULL
          AND ${table.excerptMatch} = true
          AND ${table.responseBytes} IS NOT NULL
          AND ${table.errorCode} IS NULL
          AND jsonb_typeof(${table.attachmentSnapshot}) = 'array'
          AND jsonb_array_length(${table.attachmentSnapshot}) > 0
          AND ${table.verificationNote} IS NOT NULL
        )
      )`,
    ),
  ],
);

export const claimReviews = pgTable(
  "claim_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    reviewNumber: integer("review_number").notNull(),
    assessment: claimAssessmentEnum("assessment").notNull(),
    rationale: varchar("rationale", { length: 2_000 }).notNull(),
    limitations: varchar("limitations", { length: 2_000 }),
    reviewerId: varchar("reviewer_id", { length: 100 })
      .notNull()
      .default("legacy-local"),
    reviewerName: varchar("reviewer_name", { length: 255 })
      .notNull()
      .default("本地历史审核"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("claim_reviews_claim_number_uq").on(
      table.claimId,
      table.reviewNumber,
    ),
    index("claim_reviews_claim_created_idx").on(table.claimId, table.createdAt),
    check("claim_reviews_number_chk", sql`${table.reviewNumber} > 0`),
  ],
);

export const sourceAuthorityAssessments = pgTable(
  "source_authority_assessments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => claimEvidence.id, { onDelete: "cascade" }),
    evidenceVersion: integer("evidence_version").notNull(),
    level: sourceAuthorityLevelEnum("level").notNull(),
    publisher: varchar("publisher", { length: 300 }).notNull(),
    rationale: varchar("rationale", { length: 1_000 }).notNull(),
    assessorId: varchar("assessor_id", { length: 100 }).notNull(),
    assessorName: varchar("assessor_name", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("source_authority_evidence_created_idx").on(
      table.evidenceId,
      table.createdAt,
    ),
    check(
      "source_authority_evidence_version_chk",
      sql`${table.evidenceVersion} > 0`,
    ),
  ],
);

export const independentClaimReviews = pgTable(
  "independent_claim_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    claimReviewId: uuid("claim_review_id")
      .notNull()
      .references(() => claimReviews.id, { onDelete: "cascade" }),
    decision: independentReviewDecisionEnum("decision").notNull(),
    rationale: varchar("rationale", { length: 2_000 }).notNull(),
    inputHash: varchar("input_hash", { length: 64 }).notNull(),
    inputSnapshot: jsonb("input_snapshot").notNull(),
    reviewerId: varchar("reviewer_id", { length: 100 }).notNull(),
    reviewerName: varchar("reviewer_name", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("independent_claim_reviews_review_reviewer_uq").on(
      table.claimReviewId,
      table.reviewerId,
    ),
    index("independent_claim_reviews_review_created_idx").on(
      table.claimReviewId,
      table.createdAt,
    ),
  ],
);

export const knowledgeReleases = pgTable(
  "knowledge_releases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    claimReviewId: uuid("claim_review_id")
      .notNull()
      .references(() => claimReviews.id, { onDelete: "cascade" }),
    releaseNumber: integer("release_number").notNull(),
    snapshotHash: varchar("snapshot_hash", { length: 64 }).notNull(),
    snapshot: jsonb("snapshot").notNull(),
    publishedById: varchar("published_by_id", { length: 100 }).notNull(),
    publishedByName: varchar("published_by_name", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("knowledge_releases_claim_number_uq").on(
      table.claimId,
      table.releaseNumber,
    ),
    uniqueIndex("knowledge_releases_snapshot_hash_uq").on(table.snapshotHash),
    index("knowledge_releases_claim_created_idx").on(
      table.claimId,
      table.createdAt,
    ),
    check("knowledge_releases_number_chk", sql`${table.releaseNumber} > 0`),
  ],
);

export const claimReviewEvidence = pgTable(
  "claim_review_evidence",
  {
    reviewId: uuid("review_id")
      .notNull()
      .references(() => claimReviews.id, { onDelete: "cascade" }),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => claimEvidence.id, { onDelete: "cascade" }),
    sourceCheckId: uuid("source_check_id").notNull(),
    stance: evidenceStanceEnum("stance").notNull(),
    sourceUrl: varchar("source_url", { length: 2_000 }).notNull(),
    sourceTitle: varchar("source_title", { length: 300 }).notNull(),
    excerpt: varchar("excerpt", { length: 2_000 }).notNull(),
    finalUrl: varchar("final_url", { length: 2_000 }).notNull(),
    sourceContentHash: varchar("source_content_hash", { length: 64 }).notNull(),
    sourceCheckedAt: timestamp("source_checked_at", { withTimezone: true })
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.reviewId, table.evidenceId] }),
    index("claim_review_evidence_evidence_idx").on(table.evidenceId),
  ],
);

export const claimAiAudits = pgTable(
  "claim_ai_audits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    processingRunId: uuid("processing_run_id")
      .notNull()
      .references(() => aiProcessingRuns.id, { onDelete: "cascade" }),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    sourceClaimUpdatedAt: timestamp("source_claim_updated_at", {
      withTimezone: true,
    }).notNull(),
    sourceEvidenceFingerprint: varchar("source_evidence_fingerprint", {
      length: 64,
    }).notNull(),
    schemaVersion: varchar("schema_version", { length: 40 }).notNull(),
    evidenceSnapshot: jsonb("evidence_snapshot").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("claim_ai_audits_run_uq").on(table.processingRunId),
    index("claim_ai_audits_claim_created_idx").on(
      table.claimId,
      table.createdAt,
    ),
  ],
);

export const topicSyntheses = pgTable(
  "topic_syntheses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    sourceHash: varchar("source_hash", { length: 64 }).notNull(),
    sourceSnapshot: jsonb("source_snapshot").notNull(),
    provider: varchar("provider", { length: 40 }).notNull(),
    model: varchar("model", { length: 80 }).notNull(),
    promptVersion: varchar("prompt_version", { length: 40 }).notNull(),
    schemaVersion: varchar("schema_version", { length: 40 }).notNull(),
    status: aiRunStatusEnum("status").notNull().default("running"),
    decision: topicSynthesisDecisionEnum("decision")
      .notNull()
      .default("pending"),
    payload: jsonb("payload"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    latencyMs: integer("latency_ms"),
    errorCode: varchar("error_code", { length: 80 }),
    requestId: varchar("request_id", { length: 80 }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("topic_syntheses_category_created_idx").on(
      table.categoryId,
      table.createdAt,
    ),
    index("topic_syntheses_status_created_idx").on(
      table.status,
      table.createdAt,
    ),
  ],
);

export const dataImportRuns = pgTable(
  "data_import_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorId: varchar("actor_id", { length: 100 }).notNull(),
    actorName: varchar("actor_name", { length: 255 }).notNull(),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    fileSha256: varchar("file_sha256", { length: 64 }).notNull(),
    formatVersion: varchar("format_version", { length: 20 }).notNull(),
    status: dataImportStatusEnum("status").notNull().default("previewed"),
    stagedPayload: jsonb("staged_payload").notNull(),
    previewSummary: jsonb("preview_summary").notNull(),
    resultSummary: jsonb("result_summary"),
    errorCode: varchar("error_code", { length: 80 }),
    errorMessage: varchar("error_message", { length: 1_000 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("data_import_runs_actor_created_idx").on(
      table.actorId,
      table.createdAt,
    ),
    index("data_import_runs_status_created_idx").on(
      table.status,
      table.createdAt,
    ),
    check(
      "data_import_runs_file_sha256_chk",
      sql`char_length(${table.fileSha256}) = 64`,
    ),
  ],
);

export type CaptureRow = typeof captures.$inferSelect;
export type CategoryRow = typeof categories.$inferSelect;
export type AIRunRow = typeof aiProcessingRuns.$inferSelect;
export type AISuggestionRow = typeof aiSuggestions.$inferSelect;
export type ClaimRow = typeof claims.$inferSelect;
export type ClaimEvidenceRow = typeof claimEvidence.$inferSelect;
export type ClaimEvidenceRevisionRow = typeof claimEvidenceRevisions.$inferSelect;
export type EvidenceAttachmentRow = typeof evidenceAttachments.$inferSelect;
export type EvidenceSourceCheckRow = typeof evidenceSourceChecks.$inferSelect;
export type ClaimReviewRow = typeof claimReviews.$inferSelect;
export type ClaimAIAuditRow = typeof claimAiAudits.$inferSelect;
export type TopicSynthesisRow = typeof topicSyntheses.$inferSelect;
export type SourceAuthorityAssessmentRow = typeof sourceAuthorityAssessments.$inferSelect;
export type IndependentClaimReviewRow = typeof independentClaimReviews.$inferSelect;
export type KnowledgeReleaseRow = typeof knowledgeReleases.$inferSelect;
export type DataImportRunRow = typeof dataImportRuns.$inferSelect;
