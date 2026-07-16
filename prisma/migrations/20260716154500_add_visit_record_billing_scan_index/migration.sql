-- Bound tenant-month billing inventory scans before applying the stable watermark.
CREATE INDEX "VisitRecord_billing_month_scan_idx"
ON "VisitRecord"("org_id", "visit_date", "created_at", "id");
