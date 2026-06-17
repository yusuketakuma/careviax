-- Allow append-only rejected dispense-audit history while preserving one terminal approval.
DROP INDEX IF EXISTS "DispenseAudit_task_id_non_hold_unique";

CREATE UNIQUE INDEX "DispenseAudit_task_id_approved_unique"
  ON "DispenseAudit" ("task_id")
  WHERE result IN ('approved', 'emergency_approved');
