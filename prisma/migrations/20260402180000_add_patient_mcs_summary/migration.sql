-- CreateTable
CREATE TABLE "PatientMcsSummary" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "link_id" TEXT NOT NULL,
    "generation_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "requested_provider" TEXT NOT NULL,
    "is_fallback" BOOLEAN NOT NULL DEFAULT false,
    "model" TEXT,
    "fallback_reason" TEXT,
    "headline" TEXT NOT NULL,
    "bullets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "must_check_today" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "suggested_actions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source_refs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "other_professional_message_count" INTEGER NOT NULL DEFAULT 0,
    "latest_posted_at" TIMESTAMP(3),
    "generated_at" TIMESTAMP(3) NOT NULL,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientMcsSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PatientMcsSummary_patient_id_key" ON "PatientMcsSummary"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "PatientMcsSummary_link_id_key" ON "PatientMcsSummary"("link_id");

-- CreateIndex
CREATE INDEX "PatientMcsSummary_org_id_idx" ON "PatientMcsSummary"("org_id");

-- CreateIndex
CREATE INDEX "PatientMcsSummary_patient_id_idx" ON "PatientMcsSummary"("patient_id");

-- CreateIndex
CREATE INDEX "PatientMcsSummary_link_id_idx" ON "PatientMcsSummary"("link_id");

-- AddForeignKey
ALTER TABLE "PatientMcsSummary" ADD CONSTRAINT "PatientMcsSummary_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientMcsSummary" ADD CONSTRAINT "PatientMcsSummary_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "PatientMcsLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS Policy
ALTER TABLE "PatientMcsSummary" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PatientMcsSummary"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "PatientMcsSummary" FORCE ROW LEVEL SECURITY;
