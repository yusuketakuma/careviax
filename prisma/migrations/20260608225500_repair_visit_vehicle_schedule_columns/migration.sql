ALTER TABLE "VisitSchedule"
  ADD COLUMN IF NOT EXISTS "vehicle_resource_id" TEXT;

ALTER TABLE "VisitScheduleProposal"
  ADD COLUMN IF NOT EXISTS "vehicle_resource_id" TEXT;

ALTER TABLE "VisitPreparation"
  ADD COLUMN IF NOT EXISTS "route_plan_snapshot" JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'VisitVehicleResource_id_org_id_key'
  ) THEN
    ALTER TABLE "VisitVehicleResource"
      ADD CONSTRAINT "VisitVehicleResource_id_org_id_key"
      UNIQUE ("id", "org_id");
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'VisitSchedule_vehicle_resource_id_org_id_fkey'
  ) THEN
    ALTER TABLE "VisitSchedule"
      ADD CONSTRAINT "VisitSchedule_vehicle_resource_id_org_id_fkey"
      FOREIGN KEY ("vehicle_resource_id", "org_id") REFERENCES "VisitVehicleResource"("id", "org_id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'VisitScheduleProposal_vehicle_resource_id_org_id_fkey'
  ) THEN
    ALTER TABLE "VisitScheduleProposal"
      ADD CONSTRAINT "VisitScheduleProposal_vehicle_resource_id_org_id_fkey"
      FOREIGN KEY ("vehicle_resource_id", "org_id") REFERENCES "VisitVehicleResource"("id", "org_id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "VisitSchedule_org_id_vehicle_resource_id_idx"
  ON "VisitSchedule"("org_id", "vehicle_resource_id");

CREATE INDEX IF NOT EXISTS "VisitScheduleProposal_org_id_vehicle_resource_id_idx"
  ON "VisitScheduleProposal"("org_id", "vehicle_resource_id");

DROP TRIGGER IF EXISTS audit_log_visit_preparation ON "VisitPreparation";
CREATE TRIGGER audit_log_visit_preparation
AFTER INSERT OR UPDATE OR DELETE ON "VisitPreparation"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_audit_log();
