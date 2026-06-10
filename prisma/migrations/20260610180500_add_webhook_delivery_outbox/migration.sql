CREATE TABLE "WebhookDelivery" (
    "id"                      TEXT NOT NULL,
    "org_id"                  TEXT NOT NULL,
    "webhook_registration_id" TEXT NOT NULL,
    "delivery_id"             TEXT NOT NULL,
    "event"                   TEXT NOT NULL,
    "payload"                 JSONB NOT NULL,
    "url"                     TEXT NOT NULL,
    "status"                  TEXT NOT NULL DEFAULT 'pending',
    "status_code"             INTEGER,
    "error"                   TEXT,
    "attempt_count"           INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at"         TIMESTAMP(3),
    "last_attempt_at"         TIMESTAMP(3),
    "created_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"              TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebhookDelivery_delivery_id_webhook_registration_id_key"
    ON "WebhookDelivery"("delivery_id", "webhook_registration_id");

CREATE INDEX "WebhookDelivery_org_id_created_at_idx"
    ON "WebhookDelivery"("org_id", "created_at");

CREATE INDEX "WebhookDelivery_status_next_attempt_at_idx"
    ON "WebhookDelivery"("status", "next_attempt_at");

CREATE INDEX "WebhookDelivery_webhook_registration_id_idx"
    ON "WebhookDelivery"("webhook_registration_id");

ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_webhook_registration_id_fkey"
    FOREIGN KEY ("webhook_registration_id") REFERENCES "WebhookRegistration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WebhookDelivery" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WebhookDelivery"
    USING (org_id = current_setting('app.current_org_id', true))
    WITH CHECK (org_id = current_setting('app.current_org_id', true));
