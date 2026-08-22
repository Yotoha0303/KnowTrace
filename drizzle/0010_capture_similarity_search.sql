CREATE INDEX IF NOT EXISTS "captures_similarity_trgm_idx"
  ON "captures" USING gist (
    (coalesce("title", '') || ' ' || coalesce("subject", '') || ' ' || "content")
    gist_trgm_ops(siglen=32)
  );
