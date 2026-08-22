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

export const suggestionStatusEnum = pgEnum("suggestion_status", [
  "pending",
  "accepted",
  "modified",
  "rejected",
  "stale",
]);

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

export const captures = pgTable(
  "captures",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: varchar("title", { length: 200 }),
    content: text("content").notNull(),
    contentType: contentTypeEnum("content_type").notNull().default("unknown"),
    status: recordStatusEnum("status").notNull().default("active"),
    version: integer("version").notNull().default(1),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    idempotencyHash: varchar("idempotency_hash", { length: 64 }).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("captures_idempotency_key_uq").on(table.idempotencyKey),
    index("captures_status_created_idx").on(
      table.status,
      table.createdAt,
      table.id,
    ),
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
    content: text("content").notNull(),
    contentType: contentTypeEnum("content_type").notNull(),
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("categories_normalized_name_uq").on(table.normalizedName),
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
  },
  (table) => [
    index("claim_evidence_claim_created_idx").on(table.claimId, table.createdAt),
    index("claim_evidence_review_idx").on(table.reviewStatus, table.createdAt),
    index("claim_evidence_source_check_idx").on(
      table.sourceCheckStatus,
      table.sourceCheckedAt,
    ),
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

export const evidenceSourceChecks = pgTable(
  "evidence_source_checks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => claimEvidence.id, { onDelete: "cascade" }),
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
        (${table.status} = 'passed' AND ${table.finalUrl} IS NOT NULL AND ${table.httpStatus} IS NOT NULL AND ${table.contentHash} IS NOT NULL AND ${table.excerptMatch} IS NOT NULL AND ${table.responseBytes} IS NOT NULL AND ${table.errorCode} IS NULL)
        OR (${table.status} = 'failed' AND ${table.errorCode} IS NOT NULL)
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

export type CaptureRow = typeof captures.$inferSelect;
export type CategoryRow = typeof categories.$inferSelect;
export type AIRunRow = typeof aiProcessingRuns.$inferSelect;
export type AISuggestionRow = typeof aiSuggestions.$inferSelect;
export type ClaimRow = typeof claims.$inferSelect;
export type ClaimEvidenceRow = typeof claimEvidence.$inferSelect;
export type EvidenceSourceCheckRow = typeof evidenceSourceChecks.$inferSelect;
export type ClaimReviewRow = typeof claimReviews.$inferSelect;
export type ClaimAIAuditRow = typeof claimAiAudits.$inferSelect;
