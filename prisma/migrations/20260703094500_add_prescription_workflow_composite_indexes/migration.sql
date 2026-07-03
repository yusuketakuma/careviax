-- W2-P2: pure additive composite indexes for prescription workflow list/filter queries.
-- No data changes. See docs/operations/production-migration-runbook.md §2.4 for
-- CONCURRENTLY guidance when applying to a production table with significant row count.

-- MedicationCycle: list/filter by org + overall_status (dashboard/queue views)
CREATE INDEX "MedicationCycle_org_id_overall_status_idx"
    ON "MedicationCycle"("org_id", "overall_status");

-- PrescriptionIntake: list by org ordered/filtered by created_at
CREATE INDEX "PrescriptionIntake_org_id_created_at_idx"
    ON "PrescriptionIntake"("org_id", "created_at");

-- DispenseTask: list/filter by org + status (dispense queue views)
CREATE INDEX "DispenseTask_org_id_status_idx"
    ON "DispenseTask"("org_id", "status");
