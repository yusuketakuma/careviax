-- Add nullable idempotency key for new care-report delivery attempts.
-- Existing rows remain valid; application writes the key for new DeliveryRecord rows.

ALTER TABLE "DeliveryRecord"
ADD COLUMN "delivery_intent_key" TEXT;

CREATE UNIQUE INDEX "DeliveryRecord_org_id_delivery_intent_key_key"
ON "DeliveryRecord"("org_id", "delivery_intent_key");
