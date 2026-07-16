ALTER TABLE "FileAsset"
  ADD COLUMN "sha256" TEXT,
  ADD COLUMN "storage_version_id" TEXT;

UPDATE "FileAsset"
SET "sha256" = lower("metadata"->>'sha256')
WHERE "metadata"->>'sha256' ~* '^[a-f0-9]{64}$';

ALTER TABLE "FileAsset"
  ADD CONSTRAINT "FileAsset_sha256_format_check"
  CHECK ("sha256" IS NULL OR "sha256" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "FileAsset_storage_version_id_nonempty_check"
  CHECK ("storage_version_id" IS NULL OR length(btrim("storage_version_id")) > 0);
