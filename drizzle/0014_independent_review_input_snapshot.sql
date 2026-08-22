ALTER TABLE "independent_claim_reviews"
  ADD COLUMN "input_hash" varchar(64),
  ADD COLUMN "input_snapshot" jsonb;

UPDATE "independent_claim_reviews"
SET "input_hash" = repeat('0', 64),
    "input_snapshot" = '{}'::jsonb
WHERE "input_hash" IS NULL OR "input_snapshot" IS NULL;

ALTER TABLE "independent_claim_reviews"
  ALTER COLUMN "input_hash" SET NOT NULL,
  ALTER COLUMN "input_snapshot" SET NOT NULL;
