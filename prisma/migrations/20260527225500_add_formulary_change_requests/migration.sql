CREATE TABLE "FormularyChangeRequest" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "drug_master_id" TEXT NOT NULL,
    "requested_by_id" TEXT NOT NULL,
    "decided_by_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "action_type" TEXT NOT NULL,
    "requested_payload" JSONB NOT NULL,
    "current_snapshot" JSONB,
    "reason" TEXT,
    "decision_note" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormularyChangeRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FormularyChangeRequest_org_id_site_id_status_idx" ON "FormularyChangeRequest"("org_id", "site_id", "status");
CREATE INDEX "FormularyChangeRequest_org_id_drug_master_id_status_idx" ON "FormularyChangeRequest"("org_id", "drug_master_id", "status");
CREATE INDEX "FormularyChangeRequest_status_created_at_idx" ON "FormularyChangeRequest"("status", "created_at");
