-- W1-12f: Harden VisitScheduleProposal.finalized_schedule_id against cross-tenant references.
--
-- Source of truth: .agent-loop/BLOCKED.md (WF-20260625-schema-finalized-schedule-unique-orgid,
-- human-approved 2026-07-03). Prior state: finalized_schedule_id had a single-column @unique and
-- an FK referencing VisitSchedule(id) ONLY. Tenant isolation of that reference relied solely on
-- the application layer (withOrgContext); the database allowed a proposal in org A to point at a
-- VisitSchedule in org B. This migration adds a DB-level backstop (defense-in-depth):
--   1. VisitSchedule gains a composite UNIQUE (id, org_id) so it can be a composite FK target.
--   2. VisitScheduleProposal.finalized_schedule_id is re-pointed to a COMPOSITE FK
--      (finalized_schedule_id, org_id) -> VisitSchedule(id, org_id), so a cross-org row is
--      rejected by the DB, not just the app.
--   3. The single-column UNIQUE on finalized_schedule_id is replaced by a composite
--      UNIQUE (finalized_schedule_id, org_id). Because VisitSchedule.id is a globally unique
--      cuid PK, per-(org, schedule) uniqueness is functionally equivalent to the old global
--      uniqueness for all non-NULL values (a given schedule id belongs to exactly one org).
--
-- NOTE on ON DELETE: the previous single-column FK used ON DELETE SET NULL. A composite FK that
-- includes the NOT NULL org_id column cannot use SET NULL (Postgres would attempt to null org_id).
-- We therefore use ON DELETE RESTRICT, matching the established idiom in this schema for composite
-- (id, org_id) FKs (e.g. VisitScheduleProposal_vehicle_resource_id_org_id_fkey,
-- VisitScheduleProposal_reproposal_source_proposal_id_org_id_fkey). This is a tightening, not a
-- relaxation: a finalized VisitSchedule can no longer be deleted while a proposal still references
-- it (the safer behavior for an audit-by-default medical system). NULLing on delete was never a
-- required workflow for a *finalized* reference.
--
-- No data rows are modified. The guard block below fails the migration loudly if any pre-existing
-- data would violate the new constraints, rather than silently dropping/altering references.
--
-- ─── ROLLBACK (forward-fix; no DOWN migrations in this repo — see runbook §3) ──────────────────
--   ALTER TABLE "VisitScheduleProposal"
--     DROP CONSTRAINT "VisitScheduleProposal_finalized_schedule_id_org_id_fkey";
--   DROP INDEX "VisitScheduleProposal_finalized_schedule_id_org_id_key";
--   DROP INDEX "VisitSchedule_id_org_id_key";
--   CREATE UNIQUE INDEX "VisitScheduleProposal_finalized_schedule_id_key"
--     ON "VisitScheduleProposal"("finalized_schedule_id");
--   ALTER TABLE "VisitScheduleProposal"
--     ADD CONSTRAINT "VisitScheduleProposal_finalized_schedule_id_fkey"
--     FOREIGN KEY ("finalized_schedule_id") REFERENCES "VisitSchedule"("id")
--     ON DELETE SET NULL ON UPDATE CASCADE;
-- (Also revert prisma/schema/visit.prisma. Mirrored in docs/operations/production-migration-runbook.md §3.1.)

-- ─── Guard: fail closed if existing data violates the new tenant-scoped constraints ───────────
DO $$
BEGIN
  -- (1) Cross-tenant / dangling finalized_schedule reference: any proposal whose
  --     finalized_schedule_id points at a VisitSchedule in a DIFFERENT org (or a missing row)
  --     would break the composite FK. Must be zero before we can enforce (id, org_id).
  IF EXISTS (
    SELECT 1
    FROM "VisitScheduleProposal" p
    LEFT JOIN "VisitSchedule" s ON s."id" = p."finalized_schedule_id"
    WHERE p."finalized_schedule_id" IS NOT NULL
      AND (s."id" IS NULL OR s."org_id" <> p."org_id")
  ) THEN
    RAISE EXCEPTION
      'VisitScheduleProposal.finalized_schedule_id references a VisitSchedule in a different org (or a missing schedule); resolve these cross-tenant/dangling references before applying the composite (id, org_id) FK';
  END IF;

  -- (2) Defensive uniqueness pre-check: any duplicate (org_id, finalized_schedule_id) pair with a
  --     non-NULL finalized_schedule_id would break the new composite UNIQUE. The old global
  --     single-column UNIQUE already prevented this, so this should be a no-op, but we verify.
  IF EXISTS (
    SELECT 1
    FROM "VisitScheduleProposal"
    WHERE "finalized_schedule_id" IS NOT NULL
    GROUP BY "org_id", "finalized_schedule_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Duplicate (org_id, finalized_schedule_id) pairs exist in VisitScheduleProposal; resolve before adding the composite unique index';
  END IF;
END $$;

-- ─── Drop the old single-column FK + UNIQUE ───────────────────────────────────────────────────
ALTER TABLE "VisitScheduleProposal" DROP CONSTRAINT "VisitScheduleProposal_finalized_schedule_id_fkey";
DROP INDEX "VisitScheduleProposal_finalized_schedule_id_key";

-- ─── Add the composite (id, org_id) target unique on VisitSchedule ─────────────────────────────
CREATE UNIQUE INDEX "VisitSchedule_id_org_id_key" ON "VisitSchedule"("id", "org_id");

-- ─── Add the tenant-scoped composite UNIQUE on the referencing side ────────────────────────────
CREATE UNIQUE INDEX "VisitScheduleProposal_finalized_schedule_id_org_id_key" ON "VisitScheduleProposal"("finalized_schedule_id", "org_id");

-- ─── Re-point finalized_schedule to the composite, tenant-safe FK ──────────────────────────────
ALTER TABLE "VisitScheduleProposal" ADD CONSTRAINT "VisitScheduleProposal_finalized_schedule_id_org_id_fkey" FOREIGN KEY ("finalized_schedule_id", "org_id") REFERENCES "VisitSchedule"("id", "org_id") ON DELETE RESTRICT ON UPDATE CASCADE;
