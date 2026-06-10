-- Expand phase for encrypted outbound webhook signing secrets.
-- Existing plaintext secrets remain readable during migration/rotation.
ALTER TABLE "WebhookRegistration"
  ADD COLUMN "secret_ciphertext" TEXT,
  ADD COLUMN "secret_iv" TEXT,
  ADD COLUMN "secret_tag" TEXT,
  ADD COLUMN "secret_key_id" TEXT,
  ADD COLUMN "secret_algorithm" TEXT NOT NULL DEFAULT 'aes-256-gcm';

ALTER TABLE "WebhookRegistration"
  ALTER COLUMN "secret" DROP NOT NULL;
