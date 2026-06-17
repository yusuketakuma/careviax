-- Prevent duplicate set plans for the same medication cycle, period, and set method.
-- Run `pnpm db:verify-migration-preconditions` before applying this migration to existing data.

CREATE UNIQUE INDEX IF NOT EXISTS "SetPlan_org_id_cycle_id_period_method_key"
  ON "SetPlan" ("org_id", "cycle_id", "target_period_start", "target_period_end", "set_method");
