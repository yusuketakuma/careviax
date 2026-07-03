-- W1-7: Enable Row Level Security on tenant tables that had NO DB-layer backstop.
--
-- Source of truth: docs/security/rls-gap-ledger.md (section 1a) + src/tools/rls-known-gaps.ts.
-- Each table below has an org_id column but ENABLE ROW LEVEL SECURITY existed nowhere,
-- so tenant isolation relied solely on application-layer org_id filtering. This migration
-- adds the defense-in-depth DB backstop (ENABLE + FORCE + tenant_isolation policy) using the
-- fail-close public.app_enforced_org_id() helper (throws when the RLS context is missing),
-- matching the hardened idiom already used across prisma/rls-policies.sql.
--
-- Design-review tables (PrescriberInstitution, User) are intentionally EXCLUDED: they touch
-- global-master / auth-identity boundaries and require a separate design decision. They remain
-- acknowledged known gaps in src/tools/rls-known-gaps.ts.
--
-- No data is changed. DROP POLICY IF EXISTS keeps the statements idempotent/re-runnable.

-- ─── PHI (最重大) ────────────────────────────────────────────────────────────
-- Patient packaging profile (服薬 PHI).
ALTER TABLE "PatientPackagingProfile" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PatientPackagingProfile";
CREATE POLICY tenant_isolation ON "PatientPackagingProfile"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "PatientPackagingProfile" FORCE ROW LEVEL SECURITY;

-- Visit-schedule contact log (患者・関係者の連絡先/やり取り, PHI 相当).
ALTER TABLE "VisitScheduleContactLog" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "VisitScheduleContactLog";
CREATE POLICY tenant_isolation ON "VisitScheduleContactLog"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "VisitScheduleContactLog" FORCE ROW LEVEL SECURITY;

-- ─── 運用データ / org 設定・マスタ ───────────────────────────────────────────
ALTER TABLE "VisitScheduleOverride" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "VisitScheduleOverride";
CREATE POLICY tenant_isolation ON "VisitScheduleOverride"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "VisitScheduleOverride" FORCE ROW LEVEL SECURITY;

ALTER TABLE "BillingRule" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "BillingRule";
CREATE POLICY tenant_isolation ON "BillingRule"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "BillingRule" FORCE ROW LEVEL SECURITY;

ALTER TABLE "BusinessHoliday" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "BusinessHoliday";
CREATE POLICY tenant_isolation ON "BusinessHoliday"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "BusinessHoliday" FORCE ROW LEVEL SECURITY;

-- Symmetric with parent Facility (already RLS-covered).
ALTER TABLE "FacilityUnit" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FacilityUnit";
CREATE POLICY tenant_isolation ON "FacilityUnit"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "FacilityUnit" FORCE ROW LEVEL SECURITY;

ALTER TABLE "FormularyChangeRequest" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FormularyChangeRequest";
CREATE POLICY tenant_isolation ON "FormularyChangeRequest"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "FormularyChangeRequest" FORCE ROW LEVEL SECURITY;

ALTER TABLE "FormularyTemplate" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FormularyTemplate";
CREATE POLICY tenant_isolation ON "FormularyTemplate"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "FormularyTemplate" FORCE ROW LEVEL SECURITY;

ALTER TABLE "NotificationRule" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "NotificationRule";
CREATE POLICY tenant_isolation ON "NotificationRule"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "NotificationRule" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PackagingMethodMaster" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PackagingMethodMaster";
CREATE POLICY tenant_isolation ON "PackagingMethodMaster"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "PackagingMethodMaster" FORCE ROW LEVEL SECURITY;

ALTER TABLE "PharmacySiteInsuranceConfig" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PharmacySiteInsuranceConfig";
CREATE POLICY tenant_isolation ON "PharmacySiteInsuranceConfig"
  USING (org_id = public.app_enforced_org_id())
  WITH CHECK (org_id = public.app_enforced_org_id());
ALTER TABLE "PharmacySiteInsuranceConfig" FORCE ROW LEVEL SECURITY;

-- ─── IntegrationJob — INTENTIONALLY NOT COVERED (skip RLS for safety) ─────────
-- IntegrationJob.org_id is nullable and the job runner (src/server/jobs/runner.ts)
-- create/update rows via the BASE prisma client OUTSIDE withOrgContext (see
-- runJob → runJobOnce). The /api/jobs admin path passes a non-NULL org_id
-- (route.ts → refreshMedicalInstitutionMaster/refreshCareServiceOfficeMaster with
-- targetOrgIds:[ctx.orgId] → runJob(..., orgId)), so a fail-close FORCE-RLS policy
-- would RAISE 'RLS context missing' on that INSERT and 500 the master-refresh
-- endpoint under any RLS-enforcing (non-superuser) prod role. System jobs must stay
-- accessible regardless of context. RLS is therefore skipped here on purpose until
-- the runner is reworked to wrap org-scoped writes in withOrgContext; the gap is
-- tracked in src/tools/rls-known-gaps.ts (RLS_MISSING_GAPS).
