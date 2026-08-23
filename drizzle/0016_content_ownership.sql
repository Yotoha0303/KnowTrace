ALTER TABLE "captures" ADD COLUMN "created_by_id" varchar(100) DEFAULT 'legacy-local' NOT NULL;
--> statement-breakpoint
ALTER TABLE "captures" ADD COLUMN "created_by_name" varchar(255) DEFAULT '本地历史数据' NOT NULL;
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "created_by_id" varchar(100) DEFAULT 'legacy-local' NOT NULL;
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "created_by_name" varchar(255) DEFAULT '本地历史数据' NOT NULL;
--> statement-breakpoint
DROP INDEX "captures_idempotency_key_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "captures_creator_idempotency_key_uq" ON "captures" ("created_by_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX "captures_creator_status_created_idx" ON "captures" ("created_by_id", "status", "created_at", "id");
--> statement-breakpoint
DROP INDEX "categories_normalized_name_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "categories_creator_normalized_name_uq" ON "categories" ("created_by_id", "normalized_name");
--> statement-breakpoint
CREATE INDEX "categories_creator_status_name_idx" ON "categories" ("created_by_id", "status", "name");
