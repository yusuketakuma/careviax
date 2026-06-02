ALTER TABLE "QrScanDraft"
  ADD COLUMN "qr_payload_hash" TEXT;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

WITH "canonical_payloads" AS (
  SELECT
    "draft"."id",
    encode(
      digest(
        COALESCE(
          (
            SELECT
              '[' || string_agg(to_jsonb("normalized"."page")::text, ',' ORDER BY "normalized"."page") || ']'
            FROM (
              SELECT DISTINCT replace(btrim("pages"."page_value"), E'\r\n', E'\n') AS "page"
              FROM jsonb_array_elements_text("draft"."raw_qr_texts") AS "pages"("page_value")
            ) AS "normalized"
          ),
          '[]'
        ),
        'sha256'
      ),
      'hex'
    ) AS "payload_hash"
  FROM "QrScanDraft" AS "draft"
  WHERE jsonb_typeof("draft"."raw_qr_texts") = 'array'
),
"active_ranked_payloads" AS (
  SELECT
    "draft"."id",
    "canonical_payloads"."payload_hash",
    row_number() OVER (
      PARTITION BY "draft"."org_id", "canonical_payloads"."payload_hash"
      ORDER BY "draft"."created_at" ASC, "draft"."id" ASC
    ) AS "active_rank"
  FROM "QrScanDraft" AS "draft"
  JOIN "canonical_payloads" ON "canonical_payloads"."id" = "draft"."id"
  WHERE "draft"."status" IN ('pending', 'confirmed')
)
UPDATE "QrScanDraft" AS "draft"
SET "qr_payload_hash" = "canonical_payloads"."payload_hash"
FROM "canonical_payloads"
LEFT JOIN "active_ranked_payloads" ON "active_ranked_payloads"."id" = "canonical_payloads"."id"
WHERE "draft"."id" = "canonical_payloads"."id"
  AND (
    "draft"."status" NOT IN ('pending', 'confirmed')
    OR "active_ranked_payloads"."active_rank" = 1
  );

CREATE INDEX "QrScanDraft_org_id_qr_payload_hash_idx"
  ON "QrScanDraft"("org_id", "qr_payload_hash");

CREATE UNIQUE INDEX "QrScanDraft_active_payload_hash_key"
  ON "QrScanDraft"("org_id", "qr_payload_hash")
  WHERE "qr_payload_hash" IS NOT NULL
    AND "status" IN ('pending', 'confirmed');
