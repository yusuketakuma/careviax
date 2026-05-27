CREATE TABLE "FormularyTemplate" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "source_site_id" TEXT,
  "created_by_id" TEXT NOT NULL,
  "items" JSONB NOT NULL,
  "item_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "FormularyTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FormularyTemplate_org_id_created_at_idx" ON "FormularyTemplate"("org_id", "created_at");
CREATE INDEX "FormularyTemplate_org_id_name_idx" ON "FormularyTemplate"("org_id", "name");
