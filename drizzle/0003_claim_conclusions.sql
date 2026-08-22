ALTER TYPE "claim_status" ADD VALUE IF NOT EXISTS 'concluded';
--> statement-breakpoint
CREATE TYPE "claim_assessment" AS ENUM (
  'supported',
  'refuted',
  'inconclusive'
);
--> statement-breakpoint
CREATE TABLE "claim_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "claim_id" uuid NOT NULL REFERENCES "claims"("id") ON DELETE CASCADE,
  "review_number" integer NOT NULL,
  "assessment" "claim_assessment" NOT NULL,
  "rationale" varchar(2000) NOT NULL,
  "limitations" varchar(2000),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "claim_reviews_number_chk" CHECK ("review_number" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "claim_reviews_claim_number_uq"
  ON "claim_reviews" ("claim_id", "review_number");
--> statement-breakpoint
CREATE INDEX "claim_reviews_claim_created_idx"
  ON "claim_reviews" ("claim_id", "created_at");
--> statement-breakpoint
CREATE TABLE "claim_review_evidence" (
  "review_id" uuid NOT NULL REFERENCES "claim_reviews"("id") ON DELETE CASCADE,
  "evidence_id" uuid NOT NULL REFERENCES "claim_evidence"("id") ON DELETE CASCADE,
  "source_check_id" uuid NOT NULL,
  "stance" "evidence_stance" NOT NULL,
  "source_url" varchar(2000) NOT NULL,
  "source_title" varchar(300) NOT NULL,
  "excerpt" varchar(2000) NOT NULL,
  "final_url" varchar(2000) NOT NULL,
  "source_content_hash" varchar(64) NOT NULL,
  "source_checked_at" timestamptz NOT NULL,
  PRIMARY KEY ("review_id", "evidence_id")
);
--> statement-breakpoint
CREATE INDEX "claim_review_evidence_evidence_idx"
  ON "claim_review_evidence" ("evidence_id");
