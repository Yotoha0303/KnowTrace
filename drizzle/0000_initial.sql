CREATE TYPE "content_type" AS ENUM (
  'keyword_set',
  'thought_fragment',
  'experience',
  'observation',
  'question',
  'source_note',
  'mixed',
  'unknown'
);
--> statement-breakpoint
CREATE TYPE "record_status" AS ENUM ('active', 'archived');
--> statement-breakpoint
CREATE TYPE "category_assigned_by" AS ENUM ('manual', 'ai_accepted');
--> statement-breakpoint
CREATE TYPE "ai_run_status" AS ENUM ('running', 'succeeded', 'failed', 'cancelled');
--> statement-breakpoint
CREATE TYPE "suggestion_status" AS ENUM ('pending', 'accepted', 'modified', 'rejected', 'stale');
--> statement-breakpoint
CREATE TABLE "captures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title" varchar(200),
  "content" text NOT NULL,
  "content_type" "content_type" DEFAULT 'unknown' NOT NULL,
  "status" "record_status" DEFAULT 'active' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "idempotency_key" varchar(128) NOT NULL,
  "idempotency_hash" varchar(64) NOT NULL,
  "archived_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "captures_content_length_chk" CHECK (char_length("content") BETWEEN 1 AND 20000),
  CONSTRAINT "captures_version_chk" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "captures_idempotency_key_uq" ON "captures" ("idempotency_key");
--> statement-breakpoint
CREATE INDEX "captures_status_created_idx" ON "captures" ("status", "created_at", "id");
--> statement-breakpoint
CREATE TABLE "capture_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "capture_id" uuid NOT NULL REFERENCES "captures"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "title" varchar(200),
  "content" text NOT NULL,
  "content_type" "content_type" NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "capture_revisions_capture_version_uq" ON "capture_revisions" ("capture_id", "version");
--> statement-breakpoint
CREATE INDEX "capture_revisions_capture_idx" ON "capture_revisions" ("capture_id", "version");
--> statement-breakpoint
CREATE TABLE "categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(60) NOT NULL,
  "normalized_name" varchar(80) NOT NULL,
  "description" varchar(500),
  "status" "record_status" DEFAULT 'active' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "categories_normalized_name_uq" ON "categories" ("normalized_name");
--> statement-breakpoint
CREATE INDEX "categories_status_name_idx" ON "categories" ("status", "name");
--> statement-breakpoint
CREATE TABLE "capture_categories" (
  "capture_id" uuid NOT NULL REFERENCES "captures"("id") ON DELETE CASCADE,
  "category_id" uuid NOT NULL REFERENCES "categories"("id") ON DELETE RESTRICT,
  "assigned_by" "category_assigned_by" DEFAULT 'manual' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY ("capture_id", "category_id")
);
--> statement-breakpoint
CREATE INDEX "capture_categories_category_idx" ON "capture_categories" ("category_id", "capture_id");
--> statement-breakpoint
CREATE TABLE "ai_processing_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "capture_id" uuid NOT NULL REFERENCES "captures"("id") ON DELETE CASCADE,
  "capture_version" integer NOT NULL,
  "input_hash" varchar(64) NOT NULL,
  "task_type" varchar(40) DEFAULT 'organize' NOT NULL,
  "provider" varchar(40) NOT NULL,
  "model" varchar(80) NOT NULL,
  "prompt_version" varchar(40) NOT NULL,
  "schema_version" varchar(40) NOT NULL,
  "status" "ai_run_status" DEFAULT 'running' NOT NULL,
  "input_tokens" integer,
  "output_tokens" integer,
  "latency_ms" integer,
  "error_code" varchar(80),
  "request_id" varchar(80) NOT NULL,
  "started_at" timestamptz DEFAULT now() NOT NULL,
  "completed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ai_runs_capture_created_idx" ON "ai_processing_runs" ("capture_id", "created_at");
--> statement-breakpoint
CREATE INDEX "ai_runs_status_started_idx" ON "ai_processing_runs" ("status", "started_at");
--> statement-breakpoint
CREATE TABLE "ai_suggestions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "processing_run_id" uuid NOT NULL REFERENCES "ai_processing_runs"("id") ON DELETE CASCADE,
  "capture_id" uuid NOT NULL REFERENCES "captures"("id") ON DELETE CASCADE,
  "source_capture_version" integer NOT NULL,
  "schema_version" varchar(40) NOT NULL,
  "payload" jsonb NOT NULL,
  "status" "suggestion_status" DEFAULT 'pending' NOT NULL,
  "accepted_payload" jsonb,
  "decided_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_suggestions_run_uq" ON "ai_suggestions" ("processing_run_id");
--> statement-breakpoint
CREATE INDEX "ai_suggestions_capture_created_idx" ON "ai_suggestions" ("capture_id", "created_at");
