CREATE TABLE "PcaPumpRentalAccessory" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "rental_id" TEXT NOT NULL,
  "accessory_key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "expected_quantity" INTEGER NOT NULL DEFAULT 1,
  "checked_out_quantity" INTEGER NOT NULL DEFAULT 1,
  "returned_quantity" INTEGER,
  "checkout_condition" TEXT NOT NULL DEFAULT 'ok',
  "return_condition" TEXT,
  "discrepancy_status" TEXT NOT NULL DEFAULT 'unchecked',
  "billable" BOOLEAN NOT NULL DEFAULT false,
  "charge_amount_yen" INTEGER,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PcaPumpRentalAccessory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PcaPumpRentalAccessory_quantity_check"
    CHECK (
      "expected_quantity" >= 0
      AND "checked_out_quantity" >= 0
      AND ("returned_quantity" IS NULL OR "returned_quantity" >= 0)
    ),
  CONSTRAINT "PcaPumpRentalAccessory_charge_check"
    CHECK ("charge_amount_yen" IS NULL OR "charge_amount_yen" > 0),
  CONSTRAINT "PcaPumpRentalAccessory_checkout_condition_check"
    CHECK ("checkout_condition" IN ('ok', 'not_applicable')),
  CONSTRAINT "PcaPumpRentalAccessory_return_condition_check"
    CHECK (
      "return_condition" IS NULL
      OR "return_condition" IN ('ok', 'missing', 'damaged', 'not_applicable')
    ),
  CONSTRAINT "PcaPumpRentalAccessory_discrepancy_status_check"
    CHECK ("discrepancy_status" IN ('unchecked', 'none', 'missing', 'damaged', 'not_applicable')),
  CONSTRAINT "PcaPumpRentalAccessory_billable_charge_check"
    CHECK (
      ("billable" = false AND "charge_amount_yen" IS NULL)
      OR (
        "billable" = true
        AND "charge_amount_yen" > 0
        AND "discrepancy_status" IN ('missing', 'damaged')
      )
    )
);

ALTER TABLE "PcaPumpRentalAccessory"
  ADD CONSTRAINT "PcaPumpRentalAccessory_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PcaPumpRentalAccessory_rental_id_org_id_fkey"
  FOREIGN KEY ("rental_id", "org_id") REFERENCES "PcaPumpRental"("id", "org_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "PcaPumpRentalAccessory_org_id_rental_id_accessory_key_key"
  ON "PcaPumpRentalAccessory"("org_id", "rental_id", "accessory_key");

CREATE INDEX "PcaPumpRentalAccessory_org_id_rental_id_idx"
  ON "PcaPumpRentalAccessory"("org_id", "rental_id");

CREATE INDEX "PcaPumpRentalAccessory_org_id_discrepancy_status_idx"
  ON "PcaPumpRentalAccessory"("org_id", "discrepancy_status");

CREATE INDEX "PcaPumpRentalAccessory_org_id_billable_idx"
  ON "PcaPumpRentalAccessory"("org_id", "billable");

INSERT INTO "PcaPumpRentalAccessory" (
  "id",
  "org_id",
  "rental_id",
  "accessory_key",
  "name",
  "expected_quantity",
  "checked_out_quantity",
  "returned_quantity",
  "checkout_condition",
  "return_condition",
  "discrepancy_status",
  "billable",
  "charge_amount_yen",
  "notes",
  "created_at",
  "updated_at"
)
SELECT
  'pcaacc_' || md5(rental."id" || ':' || item."accessory_key"),
  rental."org_id",
  rental."id",
  item."accessory_key",
  item."name",
  1,
  1,
  CASE
    WHEN checked."status" = 'ok' THEN 1
    WHEN checked."status" IN ('missing', 'damaged', 'not_applicable') THEN 0
    ELSE NULL
  END,
  'ok',
  CASE
    WHEN checked."status" IN ('ok', 'missing', 'damaged', 'not_applicable') THEN checked."status"
    ELSE NULL
  END,
  CASE
    WHEN checked."status" = 'ok' THEN 'none'
    WHEN checked."status" IN ('missing', 'damaged', 'not_applicable') THEN checked."status"
    ELSE 'unchecked'
  END,
  false,
  NULL,
  NULLIF(BTRIM(checked."notes"), ''),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "PcaPumpRental" AS rental
CROSS JOIN (
  VALUES
    ('pump_body', 'ポンプ本体'),
    ('power_adapter', 'ACアダプタ'),
    ('power_cable', '電源コード'),
    ('carrying_case', '携行ケース'),
    ('manual', '取扱説明書'),
    ('lock_key', 'ロックキー'),
    ('clamp', 'クランプ/固定具'),
    ('cleaning_completed', '清拭完了'),
    ('operation_check', '動作確認')
) AS item("accessory_key", "name")
LEFT JOIN LATERAL (
  SELECT
    rental."accessory_checklist" -> item."accessory_key" ->> 'status' AS "status",
    rental."accessory_checklist" -> item."accessory_key" ->> 'notes' AS "notes"
) AS checked ON true
ON CONFLICT ("org_id", "rental_id", "accessory_key") DO NOTHING;

ALTER TABLE "PcaPumpRentalAccessory" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PcaPumpRentalAccessory";
CREATE POLICY tenant_isolation ON "PcaPumpRentalAccessory"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PcaPumpRentalAccessory" FORCE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS audit_log_pca_pump_rental_accessory ON "PcaPumpRentalAccessory";
CREATE TRIGGER audit_log_pca_pump_rental_accessory
AFTER INSERT OR UPDATE OR DELETE ON "PcaPumpRentalAccessory"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_audit_log();
