-- Prevent concurrent non-hold audits for the same task
CREATE UNIQUE INDEX "DispenseAudit_task_id_non_hold_unique"
  ON "DispenseAudit" ("task_id")
  WHERE result NOT IN ('hold');
