ALTER TABLE "ai_processing_runs"
ADD COLUMN "workspace_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL
REFERENCES "workspaces"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "ai_processing_runs"
ADD COLUMN "actor_id" varchar(100) DEFAULT 'legacy-unknown' NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_processing_runs"
ADD COLUMN "actor_name" varchar(255) DEFAULT '历史执行者未知' NOT NULL;
--> statement-breakpoint
UPDATE "ai_processing_runs" AS run
SET "workspace_id" = capture."workspace_id"
FROM "captures" AS capture
WHERE run."capture_id" = capture."id";
--> statement-breakpoint
ALTER TABLE "ai_processing_runs" ALTER COLUMN "workspace_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "ai_processing_runs" ALTER COLUMN "actor_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "ai_processing_runs" ALTER COLUMN "actor_name" DROP DEFAULT;
--> statement-breakpoint
CREATE INDEX "ai_runs_workspace_actor_created_idx"
ON "ai_processing_runs" ("workspace_id", "actor_id", "created_at");
--> statement-breakpoint
ALTER TABLE "topic_syntheses"
ADD COLUMN "workspace_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL
REFERENCES "workspaces"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "topic_syntheses"
ADD COLUMN "actor_id" varchar(100) DEFAULT 'legacy-unknown' NOT NULL;
--> statement-breakpoint
ALTER TABLE "topic_syntheses"
ADD COLUMN "actor_name" varchar(255) DEFAULT '历史执行者未知' NOT NULL;
--> statement-breakpoint
ALTER TABLE "topic_syntheses"
ADD COLUMN "decided_by_id" varchar(100);
--> statement-breakpoint
ALTER TABLE "topic_syntheses"
ADD COLUMN "decided_by_name" varchar(255);
--> statement-breakpoint
UPDATE "topic_syntheses" AS synthesis
SET "workspace_id" = category."workspace_id"
FROM "categories" AS category
WHERE synthesis."category_id" = category."id";
--> statement-breakpoint
ALTER TABLE "topic_syntheses" ALTER COLUMN "workspace_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "topic_syntheses" ALTER COLUMN "actor_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "topic_syntheses" ALTER COLUMN "actor_name" DROP DEFAULT;
--> statement-breakpoint
CREATE INDEX "topic_syntheses_workspace_actor_created_idx"
ON "topic_syntheses" ("workspace_id", "actor_id", "created_at");
