ALTER TABLE "User"
ADD COLUMN "credential_revocation_id" TEXT,
ADD COLUMN "credential_revocation_flow" TEXT,
ADD COLUMN "credential_revocation_pending_at" TIMESTAMP(3),
ADD COLUMN "credential_revocation_provider_completed_at" TIMESTAMP(3),
ADD COLUMN "credential_revocation_local_completed_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_org_id_credential_revocation_id_key"
ON "User"("org_id", "credential_revocation_id");
