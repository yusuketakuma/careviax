-- Split global scheduler state from tenant job state before enabling FORCE RLS.
-- Pre-release migration: existing org_id NULL rows move without compatibility views.

CREATE TABLE "SystemIntegrationJob" (
    "id" TEXT NOT NULL,
    "job_type" TEXT NOT NULL,
    "dedupe_key" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "input" JSONB,
    "output" JSONB,
    "error_log" TEXT,
    "run_at" TIMESTAMP(3),
    "locked_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "max_retries" INTEGER NOT NULL DEFAULT 3,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SystemIntegrationJob_pkey" PRIMARY KEY ("id")
);

INSERT INTO "SystemIntegrationJob" (
    "id", "job_type", "dedupe_key", "status", "input", "output", "error_log",
    "run_at", "locked_at", "started_at", "completed_at", "retry_count",
    "max_retries", "created_at", "updated_at"
)
SELECT
    "id", "job_type", "dedupe_key", "status", "input", "output", "error_log",
    "run_at", "locked_at", "started_at", "completed_at", "retry_count",
    "max_retries", "created_at", "updated_at"
FROM "IntegrationJob"
WHERE "org_id" IS NULL;

DELETE FROM "IntegrationJob" WHERE "org_id" IS NULL;
ALTER TABLE "IntegrationJob" ALTER COLUMN "org_id" SET NOT NULL;

CREATE UNIQUE INDEX "SystemIntegrationJob_job_type_dedupe_key_key"
    ON "SystemIntegrationJob"("job_type", "dedupe_key");
CREATE INDEX "SystemIntegrationJob_job_type_idx" ON "SystemIntegrationJob"("job_type");
CREATE INDEX "SystemIntegrationJob_status_idx" ON "SystemIntegrationJob"("status");
CREATE INDEX "SystemIntegrationJob_run_at_idx" ON "SystemIntegrationJob"("run_at");

ALTER TABLE "IntegrationJob" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "IntegrationJob";
CREATE POLICY tenant_isolation ON "IntegrationJob"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "IntegrationJob" FORCE ROW LEVEL SECURITY;
