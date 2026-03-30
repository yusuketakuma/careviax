-- PharmacySiteInsuranceConfig: 薬局情報 — 保険種別×改定年度ごとの算定設定
CREATE TABLE "PharmacySiteInsuranceConfig" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "insurance_type" TEXT NOT NULL,
    "revision_code" TEXT NOT NULL,
    "revision_label" TEXT,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,

    -- 医療保険: 調剤基本料
    "dispensing_fee_category" TEXT,

    -- 医療保険: 体制加算
    "regional_support_level" TEXT,
    "generic_dispensing_level" TEXT,
    "cooperation_enhancement" BOOLEAN NOT NULL DEFAULT false,
    "medical_dx_promotion" BOOLEAN NOT NULL DEFAULT false,

    -- 医療保険: 在宅関連体制加算
    "home_comprehensive_level" TEXT,

    -- 共通: 免許・許可
    "narcotic_dealer_license" BOOLEAN NOT NULL DEFAULT false,
    "high_care_medical_device_license" BOOLEAN NOT NULL DEFAULT false,

    -- 介護保険: 地域加算
    "region_special_15" BOOLEAN NOT NULL DEFAULT false,
    "region_small_office_10" BOOLEAN NOT NULL DEFAULT false,
    "region_resident_5" BOOLEAN NOT NULL DEFAULT false,

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
