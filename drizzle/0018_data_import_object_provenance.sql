CREATE TABLE "data_import_objects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "actor_id" varchar(100) NOT NULL,
  "format_version" varchar(20) NOT NULL,
  "object_type" varchar(40) NOT NULL,
  "source_key" varchar(100) NOT NULL,
  "local_id" uuid NOT NULL,
  "content_hash" varchar(64) NOT NULL,
  "import_run_id" uuid NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "data_import_objects_import_run_fk"
    FOREIGN KEY ("import_run_id") REFERENCES "data_import_runs"("id") ON DELETE RESTRICT,
  CONSTRAINT "data_import_objects_content_hash_chk"
    CHECK (char_length("content_hash") = 64),
  CONSTRAINT "data_import_objects_type_chk"
    CHECK ("object_type" IN ('capture', 'category', 'claim', 'evidence', 'attachment', 'source_check', 'review'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "data_import_objects_actor_type_source_uq"
ON "data_import_objects" ("actor_id", "object_type", "source_key");
--> statement-breakpoint
CREATE INDEX "data_import_objects_actor_local_idx"
ON "data_import_objects" ("actor_id", "object_type", "local_id");
--> statement-breakpoint
CREATE INDEX "data_import_objects_run_idx"
ON "data_import_objects" ("import_run_id");
