ALTER TABLE "AuditLog"
ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "AuditLog"
ALTER COLUMN "updated_at" DROP DEFAULT;

CREATE INDEX "Organization_name_idx" ON "Organization"("name");

CREATE INDEX "Setting_scope_scope_id_idx" ON "Setting"("scope", "scope_id");

CREATE INDEX "LabelDictionary_category_idx" ON "LabelDictionary"("category");

CREATE INDEX "DrugMasterImportLog_source_imported_at_idx" ON "DrugMasterImportLog"("source", "imported_at");

CREATE INDEX "DrugMasterImportLog_status_imported_at_idx" ON "DrugMasterImportLog"("status", "imported_at");
