ALTER TABLE "InquiryRecord"
ADD COLUMN "issue_id" TEXT;

ALTER TABLE "InquiryRecord"
ADD CONSTRAINT "InquiryRecord_issue_id_fkey"
FOREIGN KEY ("issue_id") REFERENCES "MedicationIssue"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "InquiryRecord_issue_id_idx" ON "InquiryRecord"("issue_id");

ALTER TABLE "CommunicationRequest"
ADD COLUMN "template_key" TEXT,
ADD COLUMN "recipient_name" TEXT,
ADD COLUMN "recipient_role" TEXT,
ADD COLUMN "related_entity_type" TEXT,
ADD COLUMN "related_entity_id" TEXT,
ADD COLUMN "context_snapshot" JSONB;

CREATE INDEX "CommunicationRequest_related_entity_type_related_entity_id_idx"
ON "CommunicationRequest"("related_entity_type", "related_entity_id");
