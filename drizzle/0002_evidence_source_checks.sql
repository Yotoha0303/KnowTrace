CREATE TYPE "evidence_source_check_status" AS ENUM (
  'unchecked',
  'passed',
  'failed'
);
--> statement-breakpoint
CREATE TYPE "source_check_attempt_status" AS ENUM (
  'passed',
  'failed'
);
--> statement-breakpoint
ALTER TABLE "claim_evidence"
  ADD COLUMN "source_check_status" "evidence_source_check_status" DEFAULT 'unchecked' NOT NULL,
  ADD COLUMN "source_excerpt_match" boolean,
  ADD COLUMN "source_checked_at" timestamptz,
  ADD COLUMN "latest_source_check_id" uuid,
  ADD CONSTRAINT "claim_evidence_source_check_consistency_chk" CHECK (
    ("source_check_status" = 'unchecked' AND "source_checked_at" IS NULL AND "source_excerpt_match" IS NULL AND "latest_source_check_id" IS NULL)
    OR ("source_check_status" = 'failed' AND "source_checked_at" IS NOT NULL AND "source_excerpt_match" IS NULL AND "latest_source_check_id" IS NOT NULL)
    OR ("source_check_status" = 'passed' AND "source_checked_at" IS NOT NULL AND "source_excerpt_match" IS NOT NULL AND "latest_source_check_id" IS NOT NULL)
  );
--> statement-breakpoint
CREATE INDEX "claim_evidence_source_check_idx"
  ON "claim_evidence" ("source_check_status", "source_checked_at");
--> statement-breakpoint
CREATE TABLE "evidence_source_checks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "evidence_id" uuid NOT NULL REFERENCES "claim_evidence"("id") ON DELETE CASCADE,
  "requested_url" varchar(2000) NOT NULL,
  "final_url" varchar(2000),
  "status" "source_check_attempt_status" NOT NULL,
  "http_status" integer,
  "content_type" varchar(120),
  "content_hash" varchar(64),
  "fetched_title" varchar(300),
  "excerpt_match" boolean,
  "response_bytes" integer,
  "error_code" varchar(80),
  "checked_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "evidence_source_checks_result_consistency_chk" CHECK (
    ("status" = 'passed' AND "final_url" IS NOT NULL AND "http_status" IS NOT NULL AND "content_hash" IS NOT NULL AND "excerpt_match" IS NOT NULL AND "response_bytes" IS NOT NULL AND "error_code" IS NULL)
    OR ("status" = 'failed' AND "error_code" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX "evidence_source_checks_evidence_checked_idx"
  ON "evidence_source_checks" ("evidence_id", "checked_at");
