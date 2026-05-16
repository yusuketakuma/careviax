CREATE UNIQUE INDEX IF NOT EXISTS "CareReport_org_visit_record_report_type_unique_idx"
ON "CareReport" ("org_id", "visit_record_id", "report_type")
WHERE "visit_record_id" IS NOT NULL;
