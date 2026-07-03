-- ID-2-W5: Display ID wave 5 for pharmacy-partnership org-scoped tables.
-- The columns are nullable for expand/backfill rollout. Uniqueness is enforced
-- only for assigned IDs so existing rows can be migrated in batches.

ALTER TABLE "PartnerPharmacy" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PartnerPharmacy_org_id_display_id_key" ON "PartnerPharmacy"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PharmacyPartnership" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PharmacyPartnership_org_id_display_id_key" ON "PharmacyPartnership"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PatientShareCase" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PatientShareCase_org_id_display_id_key" ON "PatientShareCase"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PatientShareConsent" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PatientShareConsent_org_id_display_id_key" ON "PatientShareConsent"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PatientLink" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PatientLink_org_id_display_id_key" ON "PatientLink"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PatientShareCorrectionRequest" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PatientShareCorrectionRequest_org_id_display_id_key" ON "PatientShareCorrectionRequest"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PharmacyVisitRequest" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PharmacyVisitRequest_org_id_display_id_key" ON "PharmacyVisitRequest"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PharmacyCooperationMessageThread" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PharmacyCooperationMessageThread_org_id_display_id_key" ON "PharmacyCooperationMessageThread"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PharmacyCooperationMessage" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PharmacyCooperationMessage_org_id_display_id_key" ON "PharmacyCooperationMessage"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PartnerVisitRecord" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PartnerVisitRecord_org_id_display_id_key" ON "PartnerVisitRecord"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "ClaimCooperationNote" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "ClaimCooperationNote_org_id_display_id_key" ON "ClaimCooperationNote"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PharmacyContract" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PharmacyContract_org_id_display_id_key" ON "PharmacyContract"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PharmacyContractVersion" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PharmacyContractVersion_org_id_display_id_key" ON "PharmacyContractVersion"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PharmacyContractFeeRule" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PharmacyContractFeeRule_org_id_display_id_key" ON "PharmacyContractFeeRule"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "VisitBillingCandidate" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "VisitBillingCandidate_org_id_display_id_key" ON "VisitBillingCandidate"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PharmacyInvoice" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PharmacyInvoice_org_id_display_id_key" ON "PharmacyInvoice"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PharmacyInvoiceItem" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PharmacyInvoiceItem_org_id_display_id_key" ON "PharmacyInvoiceItem"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "ContractDocument" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "ContractDocument_org_id_display_id_key" ON "ContractDocument"("org_id", "display_id") WHERE "display_id" IS NOT NULL;
