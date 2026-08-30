DROP INDEX "data_import_objects_actor_type_source_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "data_import_objects_actor_version_type_source_uq"
ON "data_import_objects" ("actor_id", "format_version", "object_type", "source_key");
