ALTER TABLE "PatientSelfReport"
ADD COLUMN "idempotency_key_hash" TEXT,
ADD COLUMN "request_fingerprint" TEXT;

CREATE INDEX "PatientSelfReport_org_id_external_access_grant_id_idx"
ON "PatientSelfReport"("org_id", "external_access_grant_id");

CREATE UNIQUE INDEX "PatientSelfReport_org_grant_idem_key"
ON "PatientSelfReport"("org_id", "external_access_grant_id", "idempotency_key_hash");
