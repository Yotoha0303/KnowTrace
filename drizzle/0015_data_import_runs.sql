CREATE TYPE "data_import_status" AS ENUM ('previewed', 'importing', 'completed', 'failed');
--> statement-breakpoint
CREATE TABLE "data_import_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "actor_id" varchar(100) NOT NULL,
  "actor_name" varchar(255) NOT NULL,
  "file_name" varchar(255) NOT NULL,
  "file_sha256" varchar(64) NOT NULL,
  "format_version" varchar(20) NOT NULL,
  "status" "data_import_status" DEFAULT 'previewed' NOT NULL,
  "staged_payload" jsonb NOT NULL,
  "preview_summary" jsonb NOT NULL,
  "result_summary" jsonb,
  "error_code" varchar(80),
  "error_message" varchar(1000),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  CONSTRAINT "data_import_runs_file_sha256_chk" CHECK (char_length("file_sha256") = 64)
);
--> statement-breakpoint
CREATE INDEX "data_import_runs_actor_created_idx" ON "data_import_runs" ("actor_id", "created_at");
--> statement-breakpoint
CREATE INDEX "data_import_runs_status_created_idx" ON "data_import_runs" ("status", "created_at");
