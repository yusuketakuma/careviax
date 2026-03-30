ALTER TABLE "FacilityContact"
    ADD COLUMN "preferred_contact_method" "CommunicationChannel",
    ADD COLUMN "preferred_contact_time" TEXT,
    ADD COLUMN "last_contacted_at" TIMESTAMP(3),
    ADD COLUMN "last_success_channel" "CommunicationChannel";

ALTER TABLE "ExternalProfessional"
    ADD COLUMN "preferred_contact_method" "CommunicationChannel",
    ADD COLUMN "preferred_contact_time" TEXT,
    ADD COLUMN "last_contacted_at" TIMESTAMP(3),
    ADD COLUMN "last_success_channel" "CommunicationChannel";

ALTER TABLE "PrescriberInstitution"
    ADD COLUMN "preferred_contact_method" "CommunicationChannel",
    ADD COLUMN "preferred_contact_time" TEXT,
    ADD COLUMN "last_contacted_at" TIMESTAMP(3),
    ADD COLUMN "last_success_channel" "CommunicationChannel";
