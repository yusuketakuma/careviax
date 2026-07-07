-- Add nullable tenant-local display IDs for inbound communication attachments.
-- Existing rows are not backfilled in this additive migration.

ALTER TABLE "InboundCommunicationAttachment" ADD COLUMN "display_id" TEXT;

CREATE UNIQUE INDEX "InboundCommunicationAttachment_org_id_display_id_key"
  ON "InboundCommunicationAttachment"("org_id", "display_id")
  WHERE "display_id" IS NOT NULL;
