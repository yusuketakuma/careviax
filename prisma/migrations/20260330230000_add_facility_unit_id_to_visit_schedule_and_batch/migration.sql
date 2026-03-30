-- AlterTable: add facility_unit_id to VisitSchedule
ALTER TABLE "VisitSchedule" ADD COLUMN "facility_unit_id" TEXT;

-- AlterTable: add facility_unit_id to FacilityVisitBatch
ALTER TABLE "FacilityVisitBatch" ADD COLUMN "facility_unit_id" TEXT;

-- AddForeignKey: VisitSchedule.facility_unit_id → FacilityUnit.id
ALTER TABLE "VisitSchedule" ADD CONSTRAINT "VisitSchedule_facility_unit_id_fkey" FOREIGN KEY ("facility_unit_id") REFERENCES "FacilityUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: FacilityVisitBatch.facility_unit_id → FacilityUnit.id
ALTER TABLE "FacilityVisitBatch" ADD CONSTRAINT "FacilityVisitBatch_facility_unit_id_fkey" FOREIGN KEY ("facility_unit_id") REFERENCES "FacilityUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "VisitSchedule_facility_unit_id_idx" ON "VisitSchedule"("facility_unit_id");
