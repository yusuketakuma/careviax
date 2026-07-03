-- ID-2-W3: Display ID wave 3 for visit and communication org-scoped tables.
-- The columns are nullable for expand/backfill rollout. Uniqueness is enforced
-- only for assigned IDs so existing rows can be migrated in batches.

ALTER TABLE "VisitVehicleResource" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "VisitVehicleResource_org_id_display_id_key" ON "VisitVehicleResource"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "VisitSchedule" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "VisitSchedule_org_id_display_id_key" ON "VisitSchedule"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "FacilityVisitBatch" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "FacilityVisitBatch_org_id_display_id_key" ON "FacilityVisitBatch"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "VisitRecord" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "VisitRecord_org_id_display_id_key" ON "VisitRecord"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "VisitHandoffExtraction" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "VisitHandoffExtraction_org_id_display_id_key" ON "VisitHandoffExtraction"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "VisitPreparation" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "VisitPreparation_org_id_display_id_key" ON "VisitPreparation"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "VisitScheduleProposal" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "VisitScheduleProposal_org_id_display_id_key" ON "VisitScheduleProposal"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "VisitScheduleProposalBatch" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "VisitScheduleProposalBatch_org_id_display_id_key" ON "VisitScheduleProposalBatch"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "VisitScheduleContactLog" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "VisitScheduleContactLog_org_id_display_id_key" ON "VisitScheduleContactLog"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "VisitScheduleOverride" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "VisitScheduleOverride_org_id_display_id_key" ON "VisitScheduleOverride"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "CommunicationEvent" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "CommunicationEvent_org_id_display_id_key" ON "CommunicationEvent"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "CommunicationRequest" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "CommunicationRequest_org_id_display_id_key" ON "CommunicationRequest"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "CommunicationResponse" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "CommunicationResponse_org_id_display_id_key" ON "CommunicationResponse"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "CareReport" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "CareReport_org_id_display_id_key" ON "CareReport"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "CareReportSendRequest" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "CareReportSendRequest_org_id_display_id_key" ON "CareReportSendRequest"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "DeliveryRecord" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "DeliveryRecord_org_id_display_id_key" ON "DeliveryRecord"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "ConferenceNote" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "ConferenceNote_org_id_display_id_key" ON "ConferenceNote"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "EscalationRule" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "EscalationRule_org_id_display_id_key" ON "EscalationRule"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "ExternalAccessGrant" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "ExternalAccessGrant_org_id_display_id_key" ON "ExternalAccessGrant"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "TracingReport" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "TracingReport_org_id_display_id_key" ON "TracingReport"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PatientSelfReport" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PatientSelfReport_org_id_display_id_key" ON "PatientSelfReport"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "CommunityActivity" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "CommunityActivity_org_id_display_id_key" ON "CommunityActivity"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "TaskComment" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "TaskComment_org_id_display_id_key" ON "TaskComment"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "HandoffBoard" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "HandoffBoard_org_id_display_id_key" ON "HandoffBoard"("org_id", "display_id") WHERE "display_id" IS NOT NULL;
