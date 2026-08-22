CREATE TYPE "public"."topic_synthesis_decision" AS ENUM('pending', 'accepted', 'rejected');

CREATE TABLE "topic_syntheses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "category_id" uuid NOT NULL,
  "source_hash" varchar(64) NOT NULL,
  "source_snapshot" jsonb NOT NULL,
  "provider" varchar(40) NOT NULL,
  "model" varchar(80) NOT NULL,
  "prompt_version" varchar(40) NOT NULL,
  "schema_version" varchar(40) NOT NULL,
  "status" "ai_run_status" DEFAULT 'running' NOT NULL,
  "decision" "topic_synthesis_decision" DEFAULT 'pending' NOT NULL,
  "payload" jsonb,
  "input_tokens" integer,
  "output_tokens" integer,
  "latency_ms" integer,
  "error_code" varchar(80),
  "request_id" varchar(80) NOT NULL,
  "completed_at" timestamp with time zone,
  "decided_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "topic_syntheses_category_id_categories_id_fk"
    FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id")
    ON DELETE cascade ON UPDATE no action
);

CREATE INDEX "topic_syntheses_category_created_idx"
  ON "topic_syntheses" USING btree ("category_id", "created_at");
CREATE INDEX "topic_syntheses_status_created_idx"
  ON "topic_syntheses" USING btree ("status", "created_at");
