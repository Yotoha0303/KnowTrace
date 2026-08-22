CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX "captures_search_trgm_idx"
  ON "captures" USING gin ((coalesce("title", '') || ' ' || "content") gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "claims_search_trgm_idx"
  ON "claims" USING gin (("statement" || ' ' || "source_excerpt" || ' ' || "falsification_criteria") gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "claim_evidence_search_trgm_idx"
  ON "claim_evidence" USING gin (("source_title" || ' ' || "excerpt" || ' ' || coalesce("note", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "claim_reviews_search_trgm_idx"
  ON "claim_reviews" USING gin (("rationale" || ' ' || coalesce("limitations", '')) gin_trgm_ops);
