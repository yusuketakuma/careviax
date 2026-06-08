CREATE TYPE "VisitVehicleTravelMode" AS ENUM (
  'DRIVE',
  'BICYCLE',
  'WALK',
  'TWO_WHEELER'
);

CREATE TABLE "VisitVehicleResource" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "site_id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "vehicle_code" TEXT,
  "travel_mode" "VisitVehicleTravelMode" NOT NULL DEFAULT 'DRIVE',
  "max_stops" INTEGER NOT NULL DEFAULT 8,
  "max_route_duration_minutes" INTEGER,
  "available" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "VisitVehicleResource_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VisitVehicleResource_max_stops_check"
    CHECK ("max_stops" >= 1 AND "max_stops" <= 50),
  CONSTRAINT "VisitVehicleResource_max_route_duration_minutes_check"
    CHECK (
      "max_route_duration_minutes" IS NULL
      OR ("max_route_duration_minutes" >= 1 AND "max_route_duration_minutes" <= 1440)
    ),
  CONSTRAINT "VisitVehicleResource_label_not_blank_check"
    CHECK (btrim("label") <> ''),
  CONSTRAINT "VisitVehicleResource_vehicle_code_not_blank_check"
    CHECK ("vehicle_code" IS NULL OR btrim("vehicle_code") <> '')
);

ALTER TABLE "PharmacySite"
  ADD CONSTRAINT "PharmacySite_id_org_id_key" UNIQUE ("id", "org_id");

ALTER TABLE "VisitVehicleResource"
  ADD CONSTRAINT "VisitVehicleResource_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "VisitVehicleResource_site_id_org_id_fkey"
  FOREIGN KEY ("site_id", "org_id") REFERENCES "PharmacySite"("id", "org_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VisitVehicleResource"
  ADD CONSTRAINT "VisitVehicleResource_org_id_vehicle_code_key"
  UNIQUE ("org_id", "vehicle_code");

ALTER TABLE "VisitVehicleResource"
  ADD CONSTRAINT "VisitVehicleResource_id_org_id_key"
  UNIQUE ("id", "org_id");

CREATE INDEX "VisitVehicleResource_org_id_idx"
  ON "VisitVehicleResource"("org_id");

CREATE INDEX "VisitVehicleResource_org_id_site_id_available_idx"
  ON "VisitVehicleResource"("org_id", "site_id", "available");

CREATE INDEX "VisitVehicleResource_site_id_idx"
  ON "VisitVehicleResource"("site_id");

ALTER TABLE "VisitVehicleResource" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "VisitVehicleResource";
CREATE POLICY tenant_isolation ON "VisitVehicleResource"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "VisitVehicleResource" FORCE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS audit_log_visit_vehicle_resource ON "VisitVehicleResource";
CREATE TRIGGER audit_log_visit_vehicle_resource
AFTER INSERT OR UPDATE OR DELETE ON "VisitVehicleResource"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_audit_log();

ALTER TABLE "VisitSchedule"
  ADD COLUMN "vehicle_resource_id" TEXT;

ALTER TABLE "VisitScheduleProposal"
  ADD COLUMN "vehicle_resource_id" TEXT;

ALTER TABLE "VisitPreparation"
  ADD COLUMN "route_plan_snapshot" JSONB;

ALTER TABLE "VisitSchedule"
  ADD CONSTRAINT "VisitSchedule_vehicle_resource_id_org_id_fkey"
  FOREIGN KEY ("vehicle_resource_id", "org_id") REFERENCES "VisitVehicleResource"("id", "org_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VisitScheduleProposal"
  ADD CONSTRAINT "VisitScheduleProposal_vehicle_resource_id_org_id_fkey"
  FOREIGN KEY ("vehicle_resource_id", "org_id") REFERENCES "VisitVehicleResource"("id", "org_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "VisitSchedule_org_id_vehicle_resource_id_idx"
  ON "VisitSchedule"("org_id", "vehicle_resource_id");

CREATE INDEX "VisitScheduleProposal_org_id_vehicle_resource_id_idx"
  ON "VisitScheduleProposal"("org_id", "vehicle_resource_id");

DROP TRIGGER IF EXISTS audit_log_visit_preparation ON "VisitPreparation";
CREATE TRIGGER audit_log_visit_preparation
AFTER INSERT OR UPDATE OR DELETE ON "VisitPreparation"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_audit_log();
