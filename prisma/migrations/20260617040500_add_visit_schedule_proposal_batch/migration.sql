CREATE TABLE "VisitScheduleProposalBatch" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "request_fingerprint" TEXT NOT NULL,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "VisitScheduleProposalBatch_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "VisitScheduleProposal"
ADD COLUMN "proposal_batch_id" TEXT;

CREATE UNIQUE INDEX "VisitScheduleProposalBatch_org_id_idempotency_key_key"
ON "VisitScheduleProposalBatch"("org_id", "idempotency_key");

CREATE INDEX "VisitScheduleProposalBatch_org_id_case_id_idx"
ON "VisitScheduleProposalBatch"("org_id", "case_id");

CREATE INDEX "VisitScheduleProposal_proposal_batch_id_idx"
ON "VisitScheduleProposal"("proposal_batch_id");

ALTER TABLE "VisitScheduleProposalBatch"
ADD CONSTRAINT "VisitScheduleProposalBatch_org_id_fkey"
FOREIGN KEY ("org_id") REFERENCES "Organization"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VisitScheduleProposal"
ADD CONSTRAINT "VisitScheduleProposal_proposal_batch_id_fkey"
FOREIGN KEY ("proposal_batch_id") REFERENCES "VisitScheduleProposalBatch"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VisitScheduleProposalBatch" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "VisitScheduleProposalBatch";
CREATE POLICY tenant_isolation ON "VisitScheduleProposalBatch"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());

ALTER TABLE "VisitScheduleProposalBatch" FORCE ROW LEVEL SECURITY;
