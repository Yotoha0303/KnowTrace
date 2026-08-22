ALTER TABLE "knowledge_releases"
  DROP CONSTRAINT "knowledge_releases_claim_id_claims_id_fk",
  DROP CONSTRAINT "knowledge_releases_claim_review_id_claim_reviews_id_fk";

ALTER TABLE "knowledge_releases"
  ADD CONSTRAINT "knowledge_releases_claim_id_claims_id_fk"
    FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id")
    ON DELETE cascade ON UPDATE no action,
  ADD CONSTRAINT "knowledge_releases_claim_review_id_claim_reviews_id_fk"
    FOREIGN KEY ("claim_review_id") REFERENCES "public"."claim_reviews"("id")
    ON DELETE cascade ON UPDATE no action;
