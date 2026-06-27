-- S2 operating-day calendar foundation: expand-only schema changes.

ALTER TABLE "BusinessHoliday"
  ADD COLUMN "open_time" TIME,
  ADD COLUMN "close_time" TIME;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PharmacySite_id_org_id_key'
  ) THEN
    ALTER TABLE "PharmacySite"
      ADD CONSTRAINT "PharmacySite_id_org_id_key" UNIQUE ("id", "org_id");
  END IF;
END $$;

CREATE TABLE "PharmacyOperatingHours" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "site_id" TEXT NOT NULL,
  "weekday" INTEGER NOT NULL,
  "is_open" BOOLEAN NOT NULL DEFAULT true,
  "open_time" TIME,
  "close_time" TIME,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PharmacyOperatingHours_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PharmacyOperatingHours_weekday_check" CHECK ("weekday" >= 0 AND "weekday" <= 6),
  CONSTRAINT "PharmacyOperatingHours_time_pair_check"
    CHECK (
      ("open_time" IS NULL AND "close_time" IS NULL)
      OR ("open_time" IS NOT NULL AND "close_time" IS NOT NULL AND "open_time" < "close_time")
    )
);

ALTER TABLE "BusinessHoliday"
  ADD CONSTRAINT "BusinessHoliday_time_pair_check"
    CHECK (
      ("open_time" IS NULL AND "close_time" IS NULL)
      OR ("open_time" IS NOT NULL AND "close_time" IS NOT NULL AND "open_time" < "close_time")
    );

ALTER TABLE "PharmacyOperatingHours"
  ADD CONSTRAINT "PharmacyOperatingHours_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "Organization"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PharmacyOperatingHours_site_id_org_id_fkey"
    FOREIGN KEY ("site_id", "org_id") REFERENCES "PharmacySite"("id", "org_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "PharmacyOperatingHours_site_id_weekday_key"
  ON "PharmacyOperatingHours"("site_id", "weekday");

CREATE INDEX "PharmacyOperatingHours_org_id_idx"
  ON "PharmacyOperatingHours"("org_id");

CREATE INDEX "PharmacyOperatingHours_org_id_site_id_idx"
  ON "PharmacyOperatingHours"("org_id", "site_id");

CREATE UNIQUE INDEX "BusinessHoliday_org_date_type_org_wide_key"
  ON "BusinessHoliday"("org_id", "date", "holiday_type")
  WHERE "site_id" IS NULL;

CREATE UNIQUE INDEX "BusinessHoliday_org_date_site_type_site_key"
  ON "BusinessHoliday"("org_id", "date", "site_id", "holiday_type")
  WHERE "site_id" IS NOT NULL;

ALTER TABLE "PharmacyOperatingHours" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PharmacyOperatingHours";
CREATE POLICY tenant_isolation ON "PharmacyOperatingHours"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PharmacyOperatingHours" FORCE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS audit_log_pharmacy_operating_hours ON "PharmacyOperatingHours";
CREATE TRIGGER audit_log_pharmacy_operating_hours
AFTER INSERT OR UPDATE OR DELETE ON "PharmacyOperatingHours"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_audit_log();
