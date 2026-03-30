ALTER TABLE "ConferenceNote"
ADD COLUMN "patient_id" TEXT,
ADD COLUMN "facility_id" TEXT,
ADD COLUMN "billing_eligible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "billing_code" TEXT,
ADD COLUMN "follow_up_date" TIMESTAMP(3),
ADD COLUMN "follow_up_completed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "generated_report_id" TEXT;

CREATE INDEX "ConferenceNote_patient_id_idx" ON "ConferenceNote"("patient_id");
CREATE INDEX "ConferenceNote_facility_id_idx" ON "ConferenceNote"("facility_id");
CREATE INDEX "ConferenceNote_follow_up_date_idx" ON "ConferenceNote"("follow_up_date");
