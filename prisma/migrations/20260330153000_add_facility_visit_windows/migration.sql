ALTER TABLE "Facility"
  ADD COLUMN "acceptance_time_from" TIME,
  ADD COLUMN "acceptance_time_to" TIME,
  ADD COLUMN "regular_visit_weekdays" JSONB;
