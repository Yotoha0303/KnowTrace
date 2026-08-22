CREATE TABLE "claim_ai_audits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "processing_run_id" uuid NOT NULL REFERENCES "ai_processing_runs"("id") ON DELETE CASCADE,
  "claim_id" uuid NOT NULL REFERENCES "claims"("id") ON DELETE CASCADE,
  "source_claim_updated_at" timestamptz NOT NULL,
  "source_evidence_fingerprint" varchar(64) NOT NULL,
  "schema_version" varchar(40) NOT NULL,
  "evidence_snapshot" jsonb NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "claim_ai_audits_run_uq"
  ON "claim_ai_audits" ("processing_run_id");
--> statement-breakpoint
CREATE INDEX "claim_ai_audits_claim_created_idx"
  ON "claim_ai_audits" ("claim_id", "created_at");
