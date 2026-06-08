CREATE TYPE "PcaPumpMaintenanceEventType" AS ENUM (
  'manual_status_change',
  'return_inspection',
  'maintenance_completed',
  'repair_required'
);

CREATE TYPE "PcaPumpMaintenanceResult" AS ENUM (
  'available',
  'maintenance_continues',
  'retired'
);

CREATE TABLE "PcaPumpMaintenanceEvent" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "pump_id" TEXT NOT NULL,
  "rental_id" TEXT,
  "event_type" "PcaPumpMaintenanceEventType" NOT NULL,
  "result" "PcaPumpMaintenanceResult" NOT NULL,
  "previous_status" "PcaPumpStatus",
  "next_status" "PcaPumpStatus",
  "performed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "performed_by" TEXT,
  "checklist" JSONB,
  "notes" TEXT,
  "next_maintenance_due_at" DATE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PcaPumpMaintenanceEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PcaPumpMaintenanceEvent_org_id_pump_id_performed_at_idx"
  ON "PcaPumpMaintenanceEvent"("org_id", "pump_id", "performed_at");

CREATE INDEX "PcaPumpMaintenanceEvent_org_id_rental_id_idx"
  ON "PcaPumpMaintenanceEvent"("org_id", "rental_id");

CREATE INDEX "PcaPumpMaintenanceEvent_org_id_event_type_idx"
  ON "PcaPumpMaintenanceEvent"("org_id", "event_type");

ALTER TABLE "PcaPumpRental"
  ADD CONSTRAINT "PcaPumpRental_id_org_id_key" UNIQUE ("id", "org_id");

ALTER TABLE "PcaPumpMaintenanceEvent"
  ADD CONSTRAINT "PcaPumpMaintenanceEvent_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PcaPumpMaintenanceEvent_pump_id_org_id_fkey"
  FOREIGN KEY ("pump_id", "org_id") REFERENCES "PcaPump"("id", "org_id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PcaPumpMaintenanceEvent_rental_id_org_id_fkey"
  FOREIGN KEY ("rental_id", "org_id") REFERENCES "PcaPumpRental"("id", "org_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PcaPumpMaintenanceEvent" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PcaPumpMaintenanceEvent";
CREATE POLICY tenant_isolation ON "PcaPumpMaintenanceEvent"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PcaPumpMaintenanceEvent" FORCE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS audit_log_pca_pump_maintenance_event ON "PcaPumpMaintenanceEvent";
CREATE TRIGGER audit_log_pca_pump_maintenance_event
AFTER INSERT OR UPDATE OR DELETE ON "PcaPumpMaintenanceEvent"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_audit_log();
