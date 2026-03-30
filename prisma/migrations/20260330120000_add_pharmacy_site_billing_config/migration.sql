-- PharmacySiteInsuranceConfig: 薬局情報 — 保険種別×改定年度ごとの算定設定
-- config (JSONB) に改定固有の項目を格納。TypeScript 側で型安全に管理。
CREATE TABLE "PharmacySiteInsuranceConfig" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "insurance_type" TEXT NOT NULL,
    "revision_code" TEXT NOT NULL,
    "revision_label" TEXT,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PharmacySiteInsuranceConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PharmacySiteInsuranceConfig_org_site_type_rev_key"
    ON "PharmacySiteInsuranceConfig"("org_id", "site_id", "insurance_type", "revision_code");
CREATE INDEX "PharmacySiteInsuranceConfig_org_id_idx" ON "PharmacySiteInsuranceConfig"("org_id");
CREATE INDEX "PharmacySiteInsuranceConfig_site_id_idx" ON "PharmacySiteInsuranceConfig"("site_id");

ALTER TABLE "PharmacySiteInsuranceConfig"
    ADD CONSTRAINT "PharmacySiteInsuranceConfig_site_id_fkey"
    FOREIGN KEY ("site_id") REFERENCES "PharmacySite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
