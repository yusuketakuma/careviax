-- Migration: PatientSchedulePreference structured intake columns (P-09)

ALTER TABLE "PatientSchedulePreference"
    ADD COLUMN "adl_level"           TEXT,
    ADD COLUMN "dementia_level"      TEXT,
    ADD COLUMN "swallowing_route"    TEXT,
    ADD COLUMN "care_level"          TEXT,
    ADD COLUMN "infection_isolation" BOOLEAN NOT NULL DEFAULT false;
