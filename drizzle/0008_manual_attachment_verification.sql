CREATE TYPE "evidence_verification_method" AS ENUM (
  'web',
  'manual_attachment'
);
--> statement-breakpoint
ALTER TABLE "evidence_source_checks"
  ADD COLUMN "verification_method" "evidence_verification_method" DEFAULT 'web' NOT NULL,
  ADD COLUMN "attachment_snapshot" jsonb,
  ADD COLUMN "verification_note" varchar(1000);
--> statement-breakpoint
ALTER TABLE "evidence_source_checks"
  DROP CONSTRAINT "evidence_source_checks_result_consistency_chk";
--> statement-breakpoint
ALTER TABLE "evidence_source_checks"
  ADD CONSTRAINT "evidence_source_checks_result_consistency_chk" CHECK (
    (
      "verification_method" = 'web'
      AND "attachment_snapshot" IS NULL
      AND "verification_note" IS NULL
      AND (
        ("status" = 'passed' AND "final_url" IS NOT NULL AND "http_status" IS NOT NULL AND "content_hash" IS NOT NULL AND "excerpt_match" IS NOT NULL AND "response_bytes" IS NOT NULL AND "error_code" IS NULL)
        OR ("status" = 'failed' AND "error_code" IS NOT NULL)
      )
    )
    OR (
      "verification_method" = 'manual_attachment'
      AND "status" = 'passed'
      AND "requested_url" = ''
      AND "final_url" IS NOT NULL
      AND "http_status" IS NULL
      AND "content_type" = 'application/vnd.knowtrace.evidence-attachments+json'
      AND "content_hash" IS NOT NULL
      AND "excerpt_match" = true
      AND "response_bytes" IS NOT NULL
      AND "error_code" IS NULL
      AND jsonb_typeof("attachment_snapshot") = 'array'
      AND jsonb_array_length("attachment_snapshot") > 0
      AND "verification_note" IS NOT NULL
    )
  );
