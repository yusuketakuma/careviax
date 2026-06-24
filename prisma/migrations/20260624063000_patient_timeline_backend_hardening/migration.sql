CREATE INDEX "AuditLog_org_target_created_idx"
  ON "AuditLog" ("org_id", "target_type", "target_id", "created_at" DESC);

CREATE INDEX "FirstVisitDocument_org_patient_created_idx"
  ON "FirstVisitDocument" ("org_id", "patient_id", "created_at" DESC);
