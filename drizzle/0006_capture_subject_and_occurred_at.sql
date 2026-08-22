ALTER TABLE "captures" ADD COLUMN "subject" varchar(200);
--> statement-breakpoint
ALTER TABLE "captures" ADD COLUMN "occurred_at" timestamptz;
--> statement-breakpoint
UPDATE "captures" SET "occurred_at" = "created_at" WHERE "occurred_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "captures" ALTER COLUMN "occurred_at" SET DEFAULT now();
--> statement-breakpoint
ALTER TABLE "captures" ALTER COLUMN "occurred_at" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "capture_revisions" ADD COLUMN "subject" varchar(200);
--> statement-breakpoint
ALTER TABLE "capture_revisions" ADD COLUMN "occurred_at" timestamptz;
--> statement-breakpoint
UPDATE "capture_revisions" AS revision
SET "occurred_at" = capture."occurred_at"
FROM "captures" AS capture
WHERE revision."capture_id" = capture."id"
  AND revision."occurred_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "capture_revisions" ALTER COLUMN "occurred_at" SET NOT NULL;
--> statement-breakpoint
CREATE INDEX "captures_occurred_idx" ON "captures" ("occurred_at", "id");
--> statement-breakpoint
CREATE INDEX "captures_subject_trgm_idx"
  ON "captures" USING gin ("subject" gin_trgm_ops);
--> statement-breakpoint
DROP INDEX "captures_search_trgm_idx";
--> statement-breakpoint
CREATE INDEX "captures_search_trgm_idx"
  ON "captures" USING gin ((coalesce("title", '') || ' ' || coalesce("subject", '') || ' ' || "content") gin_trgm_ops);
