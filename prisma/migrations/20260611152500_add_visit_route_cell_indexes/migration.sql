CREATE INDEX IF NOT EXISTS "VisitSchedule_route_cell_order_idx"
  ON "VisitSchedule"("org_id", "pharmacist_id", "scheduled_date", "route_order");

CREATE INDEX IF NOT EXISTS "VisitScheduleProposal_route_cell_order_idx"
  ON "VisitScheduleProposal"("org_id", "proposed_pharmacist_id", "proposed_date", "route_order");
