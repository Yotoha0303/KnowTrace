CREATE TYPE "public"."source_authority_level" AS ENUM(
  'primary', 'official', 'expert', 'secondary', 'community', 'unknown'
);
CREATE TYPE "public"."independent_review_decision" AS ENUM(
  'approved', 'changes_requested'
);

ALTER TABLE "claim_reviews"
  ADD COLUMN "reviewer_id" varchar(100) DEFAULT 'legacy-local' NOT NULL,
  ADD COLUMN "reviewer_name" varchar(255) DEFAULT '本地历史审核' NOT NULL;

CREATE TABLE "source_authority_assessments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "evidence_id" uuid NOT NULL,
  "evidence_version" integer NOT NULL,
  "level" "source_authority_level" NOT NULL,
  "publisher" varchar(300) NOT NULL,
  "rationale" varchar(1000) NOT NULL,
  "assessor_id" varchar(100) NOT NULL,
  "assessor_name" varchar(255) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "source_authority_assessments_evidence_id_claim_evidence_id_fk"
    FOREIGN KEY ("evidence_id") REFERENCES "public"."claim_evidence"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "source_authority_evidence_version_chk" CHECK ("evidence_version" > 0)
);
CREATE INDEX "source_authority_evidence_created_idx"
  ON "source_authority_assessments" USING btree ("evidence_id", "created_at");

CREATE TABLE "independent_claim_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "claim_review_id" uuid NOT NULL,
  "decision" "independent_review_decision" NOT NULL,
  "rationale" varchar(2000) NOT NULL,
  "reviewer_id" varchar(100) NOT NULL,
  "reviewer_name" varchar(255) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "independent_claim_reviews_claim_review_id_claim_reviews_id_fk"
    FOREIGN KEY ("claim_review_id") REFERENCES "public"."claim_reviews"("id")
    ON DELETE cascade ON UPDATE no action
);
CREATE UNIQUE INDEX "independent_claim_reviews_review_reviewer_uq"
  ON "independent_claim_reviews" USING btree ("claim_review_id", "reviewer_id");
CREATE INDEX "independent_claim_reviews_review_created_idx"
  ON "independent_claim_reviews" USING btree ("claim_review_id", "created_at");

CREATE TABLE "knowledge_releases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "claim_id" uuid NOT NULL,
  "claim_review_id" uuid NOT NULL,
  "release_number" integer NOT NULL,
  "snapshot_hash" varchar(64) NOT NULL,
  "snapshot" jsonb NOT NULL,
  "published_by_id" varchar(100) NOT NULL,
  "published_by_name" varchar(255) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "knowledge_releases_claim_id_claims_id_fk"
    FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id")
    ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "knowledge_releases_claim_review_id_claim_reviews_id_fk"
    FOREIGN KEY ("claim_review_id") REFERENCES "public"."claim_reviews"("id")
    ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "knowledge_releases_number_chk" CHECK ("release_number" > 0)
);
CREATE UNIQUE INDEX "knowledge_releases_claim_number_uq"
  ON "knowledge_releases" USING btree ("claim_id", "release_number");
CREATE UNIQUE INDEX "knowledge_releases_snapshot_hash_uq"
  ON "knowledge_releases" USING btree ("snapshot_hash");
CREATE INDEX "knowledge_releases_claim_created_idx"
  ON "knowledge_releases" USING btree ("claim_id", "created_at");
