-- Migration: WebhookRegistration table and UserAccountStatus enum extension

CREATE TABLE "WebhookRegistration" (
    "id"         TEXT NOT NULL,
    "org_id"     TEXT NOT NULL,
    "url"        TEXT NOT NULL,
    "secret"     TEXT NOT NULL,
    "events"     TEXT[] NOT NULL,
    "is_active"  BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookRegistration_pkey" PRIMARY KEY ("id")
);

-- Index for tenant-scoped queries
CREATE INDEX "WebhookRegistration_org_id_idx" ON "WebhookRegistration"("org_id");

-- Foreign key to Organization
ALTER TABLE "WebhookRegistration" ADD CONSTRAINT "WebhookRegistration_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS tenant isolation
ALTER TABLE "WebhookRegistration" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WebhookRegistration"
    USING (org_id = current_setting('app.current_org_id', true))
    WITH CHECK (org_id = current_setting('app.current_org_id', true));

-- Extend UserAccountStatus enum for Cognito provisioning states
ALTER TYPE "UserAccountStatus" ADD VALUE IF NOT EXISTS 'pending_cognito';
ALTER TYPE "UserAccountStatus" ADD VALUE IF NOT EXISTS 'cognito_failed';
