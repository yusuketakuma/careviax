-- Facility: total_units カラム追加
ALTER TABLE "Facility" ADD COLUMN "total_units" INTEGER;

-- FacilityUnit: 施設内ユニット
CREATE TABLE "FacilityUnit" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "facility_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "floor" TEXT,
    "unit_type" TEXT NOT NULL DEFAULT 'unit',
    "capacity" INTEGER,
    "notes" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FacilityUnit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FacilityUnit_org_id_facility_id_name_key" ON "FacilityUnit"("org_id", "facility_id", "name");
CREATE INDEX "FacilityUnit_org_id_idx" ON "FacilityUnit"("org_id");
CREATE INDEX "FacilityUnit_facility_id_idx" ON "FacilityUnit"("facility_id");
ALTER TABLE "FacilityUnit" ADD CONSTRAINT "FacilityUnit_facility_id_fkey"
    FOREIGN KEY ("facility_id") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Residence: facility_id, facility_unit_id FK 追加
ALTER TABLE "Residence" ADD COLUMN "facility_id" TEXT;
ALTER TABLE "Residence" ADD COLUMN "facility_unit_id" TEXT;
CREATE INDEX "Residence_facility_id_idx" ON "Residence"("facility_id");
CREATE INDEX "Residence_facility_unit_id_idx" ON "Residence"("facility_unit_id");
ALTER TABLE "Residence" ADD CONSTRAINT "Residence_facility_id_fkey"
    FOREIGN KEY ("facility_id") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Residence" ADD CONSTRAINT "Residence_facility_unit_id_fkey"
    FOREIGN KEY ("facility_unit_id") REFERENCES "FacilityUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
