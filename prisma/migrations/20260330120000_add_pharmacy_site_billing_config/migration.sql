-- PharmacySiteBillingConfig: 薬局×改定年度ごとの算定設定
CREATE TABLE "PharmacySiteBillingConfig" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "insurance_type" TEXT NOT NULL,
    "revision_code" TEXT NOT NULL,
    "revision_label" TEXT,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "home_comprehensive_1" BOOLEAN NOT NULL DEFAULT false,
    "home_comprehensive_2" BOOLEAN NOT NULL DEFAULT false,
    "narcotic_dealer_license" BOOLEAN NOT NULL DEFAULT false,
    "high_care_medical_device_license" BOOLEAN NOT NULL DEFAULT false,
    "region_special_15" BOOLEAN NOT NULL DEFAULT false,
    "region_small_office_10" BOOLEAN NOT NULL DEFAULT false,
    "region_resident_5" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PharmacySiteBillingConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PharmacySiteBillingConfig_org_id_site_id_insurance_type_revision_code_key"
    ON "PharmacySiteBillingConfig"("org_id", "site_id", "insurance_type", "revision_code");
CREATE INDEX "PharmacySiteBillingConfig_org_id_idx" ON "PharmacySiteBillingConfig"("org_id");
CREATE INDEX "PharmacySiteBillingConfig_site_id_idx" ON "PharmacySiteBillingConfig"("site_id");

ALTER TABLE "PharmacySiteBillingConfig"
    ADD CONSTRAINT "PharmacySiteBillingConfig_site_id_fkey"
    FOREIGN KEY ("site_id") REFERENCES "PharmacySite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
