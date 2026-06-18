ALTER TABLE "VisitScheduleProposal"
ADD COLUMN "reproposal_source_proposal_id" TEXT;

ALTER TABLE "VisitScheduleProposal"
ADD CONSTRAINT "VisitScheduleProposal_reproposal_source_not_self"
CHECK ("reproposal_source_proposal_id" IS NULL OR "reproposal_source_proposal_id" <> "id");

ALTER TABLE "VisitScheduleProposal"
ADD CONSTRAINT "VisitScheduleProposal_id_org_id_case_id_key"
UNIQUE ("id", "org_id", "case_id");

CREATE INDEX "VisitScheduleProposal_org_id_reproposal_source_proposal_id_idx"
ON "VisitScheduleProposal"("org_id", "reproposal_source_proposal_id");

ALTER TABLE "VisitScheduleProposal"
ADD CONSTRAINT "VisitScheduleProposal_reproposal_source_same_case_fkey"
FOREIGN KEY ("reproposal_source_proposal_id", "org_id", "case_id")
REFERENCES "VisitScheduleProposal"("id", "org_id", "case_id")
ON DELETE RESTRICT ON UPDATE CASCADE;
