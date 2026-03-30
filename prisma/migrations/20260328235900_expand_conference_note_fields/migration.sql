CREATE TYPE "ConferenceNoteType" AS ENUM (
    'regular',
    'pre_discharge',
    'service_manager',
    'care_team',
    'emergency',
    'death_conference'
);

ALTER TABLE "ConferenceNote"
    ADD COLUMN "note_type" "ConferenceNoteType" NOT NULL DEFAULT 'regular',
    ADD COLUMN "structured_content" JSONB,
    ADD COLUMN "metadata" JSONB;

CREATE INDEX "ConferenceNote_note_type_idx" ON "ConferenceNote"("note_type");
