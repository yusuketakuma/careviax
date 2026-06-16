ALTER TABLE "CommunicationResponse"
ADD COLUMN "response_intent_key" TEXT;

CREATE UNIQUE INDEX "CommunicationResponse_org_id_response_intent_key_key"
ON "CommunicationResponse"("org_id", "response_intent_key");
