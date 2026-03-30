-- PackagingMethodMaster: org-configurable packaging method master table
CREATE TABLE "PackagingMethodMaster" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon_key" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackagingMethodMaster_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PackagingMethodMaster_org_id_idx"
    ON "PackagingMethodMaster"("org_id");

CREATE INDEX "PackagingMethodMaster_org_id_sort_order_idx"
    ON "PackagingMethodMaster"("org_id", "sort_order");

-- Patient: add packaging_preferences JSON field
ALTER TABLE "Patient" ADD COLUMN "packaging_preferences" JSONB;
