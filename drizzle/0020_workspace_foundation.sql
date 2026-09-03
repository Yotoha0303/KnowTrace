CREATE TYPE "workspace_member_role" AS ENUM ('owner', 'member');
--> statement-breakpoint
CREATE TABLE "workspaces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(100) NOT NULL,
  "slug" varchar(80) NOT NULL,
  "created_by_id" varchar(100) NOT NULL,
  "created_by_name" varchar(255) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspaces_slug_chk" CHECK ("slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_slug_uq" ON "workspaces" ("slug");
--> statement-breakpoint
CREATE INDEX "workspaces_created_by_idx" ON "workspaces" ("created_by_id", "created_at");
--> statement-breakpoint
CREATE TABLE "workspace_memberships" (
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "actor_id" varchar(100) NOT NULL,
  "actor_name" varchar(255) NOT NULL,
  "role" "workspace_member_role" DEFAULT 'member' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_memberships_pk" PRIMARY KEY ("workspace_id", "actor_id")
);
--> statement-breakpoint
CREATE INDEX "workspace_memberships_actor_idx" ON "workspace_memberships" ("actor_id", "workspace_id");
--> statement-breakpoint
INSERT INTO "workspaces" (
  "id", "name", "slug", "created_by_id", "created_by_name"
) VALUES (
  '00000000-0000-4000-8000-000000000001',
  '默认空间',
  'legacy-default',
  'local-owner',
  '本地使用者'
);
--> statement-breakpoint
INSERT INTO "workspace_memberships" (
  "workspace_id", "actor_id", "actor_name", "role"
) VALUES
  ('00000000-0000-4000-8000-000000000001', 'local-owner', '本地使用者', 'owner'),
  ('00000000-0000-4000-8000-000000000001', 'go-user:1', '默认管理员', 'owner')
ON CONFLICT ("workspace_id", "actor_id") DO NOTHING;
--> statement-breakpoint
WITH known_actors AS (
  SELECT "created_by_id" AS actor_id, "created_by_name" AS actor_name FROM "captures"
  UNION ALL
  SELECT "created_by_id", "created_by_name" FROM "categories"
  UNION ALL
  SELECT "reviewer_id", "reviewer_name" FROM "claim_reviews"
  UNION ALL
  SELECT "assessor_id", "assessor_name" FROM "source_authority_assessments"
  UNION ALL
  SELECT "reviewer_id", "reviewer_name" FROM "independent_claim_reviews"
  UNION ALL
  SELECT "published_by_id", "published_by_name" FROM "knowledge_releases"
  UNION ALL
  SELECT "actor_id", "actor_name" FROM "data_import_runs"
), deduplicated AS (
  SELECT actor_id, max(actor_name) AS actor_name
  FROM known_actors
  WHERE actor_id IS NOT NULL AND actor_id <> ''
  GROUP BY actor_id
)
INSERT INTO "workspace_memberships" (
  "workspace_id", "actor_id", "actor_name", "role"
)
SELECT
  '00000000-0000-4000-8000-000000000001',
  actor_id,
  COALESCE(NULLIF(actor_name, ''), actor_id),
  CASE
    WHEN actor_id IN ('local-owner', 'go-user:1') THEN 'owner'::"workspace_member_role"
    ELSE 'member'::"workspace_member_role"
  END
FROM deduplicated
ON CONFLICT ("workspace_id", "actor_id") DO UPDATE
SET "actor_name" = EXCLUDED."actor_name";
--> statement-breakpoint
ALTER TABLE "captures"
ADD COLUMN "workspace_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL
REFERENCES "workspaces"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "categories"
ADD COLUMN "workspace_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL
REFERENCES "workspaces"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "data_import_runs"
ADD COLUMN "workspace_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL
REFERENCES "workspaces"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "data_import_objects"
ADD COLUMN "workspace_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL
REFERENCES "workspaces"("id") ON DELETE restrict;
--> statement-breakpoint
DROP INDEX "captures_creator_idempotency_key_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "captures_workspace_creator_idempotency_key_uq"
ON "captures" ("workspace_id", "created_by_id", "idempotency_key");
--> statement-breakpoint
DROP INDEX "captures_creator_import_fingerprint_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "captures_workspace_creator_import_fingerprint_uq"
ON "captures" ("workspace_id", "created_by_id", "import_fingerprint")
WHERE "import_fingerprint" IS NOT NULL;
--> statement-breakpoint
DROP INDEX "captures_visibility_status_created_idx";
--> statement-breakpoint
CREATE INDEX "captures_workspace_visibility_status_created_idx"
ON "captures" ("workspace_id", "visibility", "status", "created_at", "id");
--> statement-breakpoint
DROP INDEX "captures_creator_status_created_idx";
--> statement-breakpoint
CREATE INDEX "captures_workspace_creator_status_created_idx"
ON "captures" ("workspace_id", "created_by_id", "status", "created_at", "id");
--> statement-breakpoint
DROP INDEX "categories_creator_normalized_name_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "categories_workspace_creator_normalized_name_uq"
ON "categories" ("workspace_id", "created_by_id", "normalized_name");
--> statement-breakpoint
DROP INDEX "categories_creator_status_name_idx";
--> statement-breakpoint
CREATE INDEX "categories_workspace_creator_status_name_idx"
ON "categories" ("workspace_id", "created_by_id", "status", "name");
--> statement-breakpoint
DROP INDEX "data_import_runs_actor_created_idx";
--> statement-breakpoint
CREATE INDEX "data_import_runs_workspace_actor_created_idx"
ON "data_import_runs" ("workspace_id", "actor_id", "created_at");
--> statement-breakpoint
DROP INDEX "data_import_objects_actor_version_type_source_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "data_import_objects_workspace_actor_version_type_source_uq"
ON "data_import_objects" ("workspace_id", "actor_id", "format_version", "object_type", "source_key");
--> statement-breakpoint
DROP INDEX "data_import_objects_actor_local_idx";
--> statement-breakpoint
CREATE INDEX "data_import_objects_workspace_actor_local_idx"
ON "data_import_objects" ("workspace_id", "actor_id", "object_type", "local_id");
