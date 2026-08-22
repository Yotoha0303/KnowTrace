CREATE TYPE "claim_status" AS ENUM (
  'candidate',
  'investigating',
  'ready_for_review',
  'withdrawn'
);
--> statement-breakpoint
CREATE TYPE "evidence_stance" AS ENUM (
  'supports',
  'contradicts',
  'context'
);
--> statement-breakpoint
CREATE TYPE "evidence_review_status" AS ENUM (
  'unreviewed',
  'accepted',
  'rejected'
);
--> statement-breakpoint
CREATE TABLE "claims" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "capture_id" uuid NOT NULL REFERENCES "captures"("id") ON DELETE CASCADE,
  "source_suggestion_id" uuid REFERENCES "ai_suggestions"("id") ON DELETE SET NULL,
  "source_capture_version" integer NOT NULL,
  "statement" varchar(1000) NOT NULL,
  "statement_hash" varchar(64) NOT NULL,
  "source_excerpt" varchar(1000) NOT NULL,
  "falsification_criteria" varchar(1000) NOT NULL,
  "status" "claim_status" DEFAULT 'candidate' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "claims_source_version_chk" CHECK ("source_capture_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "claims_statement_hash_uq" ON "claims" ("statement_hash");
--> statement-breakpoint
CREATE INDEX "claims_capture_created_idx" ON "claims" ("capture_id", "created_at");
--> statement-breakpoint
CREATE INDEX "claims_status_updated_idx" ON "claims" ("status", "updated_at");
--> statement-breakpoint
CREATE TABLE "claim_evidence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "claim_id" uuid NOT NULL REFERENCES "claims"("id") ON DELETE CASCADE,
  "source_url" varchar(2000) NOT NULL,
  "source_title" varchar(300) NOT NULL,
  "excerpt" varchar(2000) NOT NULL,
  "stance" "evidence_stance" NOT NULL,
  "note" varchar(1000),
  "review_status" "evidence_review_status" DEFAULT 'unreviewed' NOT NULL,
  "reviewed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "claim_evidence_claim_created_idx" ON "claim_evidence" ("claim_id", "created_at");
--> statement-breakpoint
CREATE INDEX "claim_evidence_review_idx" ON "claim_evidence" ("review_status", "created_at");
