CREATE TABLE "DomainEventOutbox" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "pii_class" TEXT NOT NULL DEFAULT 'reference_only',
    "metadata" JSONB,
    "dedupe_key" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lock_token" TEXT,
    "locked_until" TIMESTAMP(3),
    "provider" TEXT,
    "provider_message_id" TEXT,
    "last_error_code" TEXT,
    "accepted_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DomainEventOutbox_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DomainEventOutbox_reference_only_chk" CHECK (
      "pii_class" = 'reference_only'
      AND "event_type" = 'notification.delivery.requested'
      AND "aggregate_type" = 'user'
      AND jsonb_typeof(COALESCE("metadata", '{}'::jsonb)) = 'object'
      AND COALESCE("metadata"->>'channel', '') IN ('sms', 'line')
      AND COALESCE("metadata"->>'source_event_type', '') <> ''
      AND COALESCE("metadata", '{}'::jsonb) - 'channel' - 'source_event_type' = '{}'::jsonb
    ),
    CONSTRAINT "DomainEventOutbox_status_chk" CHECK (
      "status" IN ('pending', 'processing', 'retry', 'accepted', 'unknown', 'dead_letter')
    ),
    CONSTRAINT "DomainEventOutbox_attempts_chk" CHECK (
      "attempt_count" >= 0 AND "max_attempts" BETWEEN 1 AND 20
    ),
    CONSTRAINT "DomainEventOutbox_processing_lease_chk" CHECK (
      "status" <> 'processing' OR ("lock_token" IS NOT NULL AND "locked_until" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "DomainEventOutbox_org_id_dedupe_key_key"
  ON "DomainEventOutbox"("org_id", "dedupe_key");
CREATE UNIQUE INDEX "DomainEventOutbox_org_id_idempotency_key_key"
  ON "DomainEventOutbox"("org_id", "idempotency_key");
CREATE INDEX "DomainEventOutbox_org_drain_idx"
  ON "DomainEventOutbox"("org_id", "status", "next_attempt_at", "created_at");
CREATE INDEX "DomainEventOutbox_org_lease_idx"
  ON "DomainEventOutbox"("org_id", "locked_until");
CREATE INDEX "DomainEventOutbox_aggregate_type_aggregate_id_idx"
  ON "DomainEventOutbox"("aggregate_type", "aggregate_id");

ALTER TABLE "DomainEventOutbox"
  ADD CONSTRAINT "DomainEventOutbox_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DomainEventOutbox" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DomainEventOutbox"
  USING (
    current_setting('app.rls_context_applied', true) = 'true'
    AND "org_id" = public.app_enforced_org_id()
  )
  WITH CHECK (
    current_setting('app.rls_context_applied', true) = 'true'
    AND "org_id" = public.app_enforced_org_id()
  );
ALTER TABLE "DomainEventOutbox" FORCE ROW LEVEL SECURITY;
