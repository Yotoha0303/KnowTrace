CREATE TYPE "capture_visibility" AS ENUM ('private', 'shared');
--> statement-breakpoint
ALTER TABLE "captures" ADD COLUMN "visibility" "capture_visibility" DEFAULT 'private' NOT NULL;
--> statement-breakpoint
ALTER TABLE "captures" ADD COLUMN "import_fingerprint" varchar(64);
--> statement-breakpoint
UPDATE "captures"
SET "visibility" = 'shared'
WHERE "created_by_id" IN ('local-owner', 'go-user:1');
--> statement-breakpoint
CREATE UNIQUE INDEX "captures_creator_import_fingerprint_uq"
ON "captures" ("created_by_id", "import_fingerprint")
WHERE "import_fingerprint" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "captures_visibility_status_created_idx"
ON "captures" ("visibility", "status", "created_at", "id");
