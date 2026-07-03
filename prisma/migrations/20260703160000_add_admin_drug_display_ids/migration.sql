ALTER TABLE "NotificationRule" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "NotificationRule_org_id_display_id_key" ON "NotificationRule"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "BillingRule" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "BillingRule_org_id_display_id_key" ON "BillingRule"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "BillingCandidate" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "BillingCandidate_org_id_display_id_key" ON "BillingCandidate"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "BillingEvidence" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "BillingEvidence_org_id_display_id_key" ON "BillingEvidence"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "Notification" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "Notification_org_id_display_id_key" ON "Notification"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "AuditLog" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "AuditLog_org_id_display_id_key" ON "AuditLog"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "Template" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "Template_org_id_display_id_key" ON "Template"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "DocumentDeliveryRule" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "DocumentDeliveryRule_org_id_display_id_key" ON "DocumentDeliveryRule"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "FileAsset" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "FileAsset_org_id_display_id_key" ON "FileAsset"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "UatFeedback" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "UatFeedback_org_id_display_id_key" ON "UatFeedback"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "SourceOfTruthMatrix" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "SourceOfTruthMatrix_org_id_display_id_key" ON "SourceOfTruthMatrix"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PushSubscription" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PushSubscription_org_id_display_id_key" ON "PushSubscription"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "WebhookRegistration" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "WebhookRegistration_org_id_display_id_key" ON "WebhookRegistration"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "WebhookDelivery" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "WebhookDelivery_org_id_display_id_key" ON "WebhookDelivery"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "IncidentReport" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "IncidentReport_org_id_display_id_key" ON "IncidentReport"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "PharmacyDrugStock" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "PharmacyDrugStock_org_id_display_id_key" ON "PharmacyDrugStock"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "FormularyChangeRequest" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "FormularyChangeRequest_org_id_display_id_key" ON "FormularyChangeRequest"("org_id", "display_id") WHERE "display_id" IS NOT NULL;

ALTER TABLE "FormularyTemplate" ADD COLUMN "display_id" TEXT;
CREATE UNIQUE INDEX "FormularyTemplate_org_id_display_id_key" ON "FormularyTemplate"("org_id", "display_id") WHERE "display_id" IS NOT NULL;
