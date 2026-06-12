-- ヒヤリハット記録(p1_09)。業務インシデントの再発防止メモを構造化保持する。
CREATE TABLE "IncidentReport" (
    "id"               TEXT NOT NULL,
    "org_id"           TEXT NOT NULL,
    "site_id"          TEXT,
    "patient_id"       TEXT,
    "title"            TEXT NOT NULL,
    "what_happened"    TEXT,
    "cause"            TEXT,
    "immediate_action" TEXT,
    "prevention_plan"  TEXT,
    "related_process"  TEXT,
    "severity"         TEXT NOT NULL DEFAULT 'near_miss',
    "status"           TEXT NOT NULL DEFAULT 'open',
    "occurred_at"      TIMESTAMP(3),
    "reported_by"      TEXT NOT NULL,
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IncidentReport_org_id_status_idx"
    ON "IncidentReport"("org_id", "status");

CREATE INDEX "IncidentReport_org_id_created_at_idx"
    ON "IncidentReport"("org_id", "created_at");

-- RLS: org_id によるテナント分離(withOrgContext の SET LOCAL app.current_org_id と対)
ALTER TABLE "IncidentReport" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "IncidentReport";
CREATE POLICY tenant_isolation ON "IncidentReport"
  USING ("org_id" = public.app_enforced_org_id())
  WITH CHECK ("org_id" = public.app_enforced_org_id());
ALTER TABLE "IncidentReport" FORCE ROW LEVEL SECURITY;
