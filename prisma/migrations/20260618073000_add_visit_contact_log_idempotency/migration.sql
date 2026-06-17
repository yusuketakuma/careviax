ALTER TABLE "VisitScheduleContactLog"
ADD COLUMN "idempotency_key" TEXT,
ADD COLUMN "request_fingerprint" TEXT;

CREATE UNIQUE INDEX "VisitScheduleContactLog_org_id_idempotency_key_key"
ON "VisitScheduleContactLog"("org_id", "idempotency_key");
