-- DropForeignKey
ALTER TABLE "FacilityContact" DROP CONSTRAINT "FacilityContact_facility_id_fkey";

-- AlterTable
ALTER TABLE "ExternalProfessional" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Facility" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "FacilityContact" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PatientSchedulePreference" ADD COLUMN     "first_visit_preferred_date" DATE,
ADD COLUMN     "first_visit_time_note" TEXT,
ADD COLUMN     "first_visit_time_slot" TEXT,
ADD COLUMN     "mcs_linked" BOOLEAN,
ADD COLUMN     "parking_available" BOOLEAN,
ADD COLUMN     "primary_contact_preference" TEXT,
ADD COLUMN     "visit_before_contact_required" BOOLEAN;

-- AddForeignKey
ALTER TABLE "FacilityContact" ADD CONSTRAINT "FacilityContact_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
