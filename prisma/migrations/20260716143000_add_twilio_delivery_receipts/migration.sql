ALTER TABLE "DomainEventOutbox"
  ADD COLUMN "provider_status" TEXT,
  ADD COLUMN "provider_status_at" TIMESTAMP(3),
  ADD COLUMN "delivered_at" TIMESTAMP(3),
  ADD COLUMN "failed_at" TIMESTAMP(3);

ALTER TABLE "DomainEventOutbox"
  DROP CONSTRAINT "DomainEventOutbox_status_chk";

ALTER TABLE "DomainEventOutbox"
  ADD CONSTRAINT "DomainEventOutbox_status_chk" CHECK (
    "status" IN (
      'pending', 'processing', 'retry', 'accepted', 'unknown', 'dead_letter',
      'delivered', 'failed'
    )
  );

CREATE TABLE "ProviderDeliveryReceipt" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "delivery_idempotency_key" TEXT NOT NULL,
    "provider_message_id" TEXT NOT NULL,
    "provider_status" TEXT NOT NULL,
    "provider_error_code" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderDeliveryReceipt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProviderDeliveryReceipt_reference_only_chk" CHECK (
      "delivery_idempotency_key" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND "provider_message_id" ~ '^(SM|MM)[0-9a-fA-F]{32}$'
      AND "provider_status" IN (
        'accepted', 'scheduled', 'queued', 'sending', 'sent', 'delivered',
        'read', 'failed', 'undelivered', 'canceled', 'partially_delivered'
      )
      AND ("provider_error_code" IS NULL OR "provider_error_code" ~ '^[0-9]{1,10}$')
    )
);

CREATE UNIQUE INDEX "ProviderDeliveryReceipt_org_id_provider_message_id_provider_status_key"
  ON "ProviderDeliveryReceipt"("org_id", "provider_message_id", "provider_status");
CREATE INDEX "ProviderDeliveryReceipt_pending_idx"
  ON "ProviderDeliveryReceipt"("org_id", "delivery_idempotency_key", "applied_at", "received_at");

ALTER TABLE "ProviderDeliveryReceipt"
  ADD CONSTRAINT "ProviderDeliveryReceipt_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProviderDeliveryReceipt" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ProviderDeliveryReceipt"
  USING (
    current_setting('app.rls_context_applied', true) = 'true'
    AND "org_id" = public.app_enforced_org_id()
  )
  WITH CHECK (
    current_setting('app.rls_context_applied', true) = 'true'
    AND "org_id" = public.app_enforced_org_id()
  );
ALTER TABLE "ProviderDeliveryReceipt" FORCE ROW LEVEL SECURITY;
