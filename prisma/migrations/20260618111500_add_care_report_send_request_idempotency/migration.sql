CREATE TABLE "CareReportSendRequest" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "report_id" TEXT NOT NULL,
  "idempotency_key_hash" TEXT NOT NULL,
  "request_fingerprint" TEXT NOT NULL,
  "claim_token" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'in_progress',
  "response_status" INTEGER,
  "response_body" JSONB,
  "completed_at" TIMESTAMP(3),
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CareReportSendRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CareReport_id_org_id_key"
ON "CareReport"("id", "org_id");

ALTER TABLE "CareReportSendRequest"
ADD CONSTRAINT "CareReportSendRequest_report_id_fkey"
FOREIGN KEY ("report_id", "org_id") REFERENCES "CareReport"("id", "org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CareReportSendRequest"
ADD CONSTRAINT "CareReportSendRequest_status_check"
CHECK ("status" IN ('in_progress', 'completed'));

ALTER TABLE "CareReportSendRequest"
ADD CONSTRAINT "CareReportSendRequest_completed_response_check"
CHECK (
  "status" <> 'completed'
  OR (
    "response_status" IS NOT NULL
    AND "response_body" IS NOT NULL
    AND "completed_at" IS NOT NULL
  )
);

CREATE UNIQUE INDEX "CareReportSendRequest_org_report_idem_key"
ON "CareReportSendRequest"("org_id", "report_id", "idempotency_key_hash");

CREATE INDEX "CareReportSendRequest_org_id_idx"
ON "CareReportSendRequest"("org_id");

CREATE INDEX "CareReportSendRequest_org_id_report_id_idx"
ON "CareReportSendRequest"("org_id", "report_id");

CREATE INDEX "CareReportSendRequest_status_idx"
ON "CareReportSendRequest"("status");

ALTER TABLE "CareReportSendRequest" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "CareReportSendRequest"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());

ALTER TABLE "CareReportSendRequest" FORCE ROW LEVEL SECURITY;
