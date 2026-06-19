-- Store the canonical FileAsset link for ConsentRecord documents while keeping
-- the legacy audited URL for backwards-compatible display.

ALTER TABLE "ConsentRecord"
  ADD COLUMN "document_file_id" TEXT;

WITH consent_document_candidates AS (
  SELECT
    "ConsentRecord"."id",
    substring(
      "ConsentRecord"."document_url"
      FROM '^/api/files/([^/?#]+)/presigned-download\?download=1$'
    ) AS "file_id"
  FROM "ConsentRecord"
  WHERE "ConsentRecord"."document_file_id" IS NULL
    AND "ConsentRecord"."document_url" ~ '^/api/files/[^/?#]+/presigned-download\?download=1$'
)
UPDATE "ConsentRecord"
SET "document_file_id" = consent_document_candidates."file_id"
FROM consent_document_candidates
WHERE "ConsentRecord"."id" = consent_document_candidates."id"
  AND EXISTS (
    SELECT 1
    FROM "FileAsset"
    WHERE "FileAsset"."id" = consent_document_candidates."file_id"
  );

CREATE INDEX "ConsentRecord_org_document_file_idx"
  ON "ConsentRecord"("org_id", "document_file_id");

ALTER TABLE "ConsentRecord"
  ADD CONSTRAINT "ConsentRecord_document_file_id_fkey"
  FOREIGN KEY ("document_file_id") REFERENCES "FileAsset"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
