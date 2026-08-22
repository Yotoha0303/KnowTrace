ALTER TABLE "claim_evidence" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD COLUMN "updated_at" timestamptz DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_version_chk" CHECK ("version" > 0);
--> statement-breakpoint
CREATE TABLE "claim_evidence_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "evidence_id" uuid NOT NULL REFERENCES "claim_evidence"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "source_url" varchar(2000) NOT NULL,
  "source_title" varchar(300) NOT NULL,
  "excerpt" varchar(2000) NOT NULL,
  "stance" "evidence_stance" NOT NULL,
  "note" varchar(1000),
  "latest_source_check_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "claim_evidence_revisions_version_chk" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "claim_evidence_revisions_evidence_version_uq" ON "claim_evidence_revisions" ("evidence_id", "version");
--> statement-breakpoint
CREATE INDEX "claim_evidence_revisions_evidence_idx" ON "claim_evidence_revisions" ("evidence_id", "version");
--> statement-breakpoint
CREATE TABLE "evidence_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "evidence_id" uuid NOT NULL REFERENCES "claim_evidence"("id") ON DELETE CASCADE,
  "original_name" varchar(255) NOT NULL,
  "storage_path" varchar(255) NOT NULL,
  "mime_type" varchar(40) NOT NULL,
  "byte_size" integer NOT NULL,
  "sha256" varchar(64) NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "evidence_attachments_byte_size_chk" CHECK ("byte_size" BETWEEN 1 AND 10485760),
  CONSTRAINT "evidence_attachments_mime_type_chk" CHECK ("mime_type" IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_attachments_storage_path_uq" ON "evidence_attachments" ("storage_path");
--> statement-breakpoint
CREATE INDEX "evidence_attachments_evidence_created_idx" ON "evidence_attachments" ("evidence_id", "created_at");
