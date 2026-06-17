DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "VisitSchedule"
    WHERE "route_order" IS NOT NULL
      AND "schedule_status" NOT IN ('cancelled', 'rescheduled')
    GROUP BY "org_id", "pharmacist_id", "scheduled_date", "route_order"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate active VisitSchedule route-order cells exist; resolve before adding uniqueness';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "VisitScheduleProposal"
    WHERE "route_order" IS NOT NULL
      AND "finalized_schedule_id" IS NULL
      AND "proposal_status" IN ('proposed', 'patient_contact_pending', 'reschedule_pending')
    GROUP BY "org_id", "proposed_pharmacist_id", "proposed_date", "route_order"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate open VisitScheduleProposal route-order cells exist; resolve before adding uniqueness';
  END IF;
END $$;

CREATE UNIQUE INDEX "VisitSchedule_active_route_order_key"
ON "VisitSchedule"("org_id", "pharmacist_id", "scheduled_date", "route_order")
WHERE "route_order" IS NOT NULL
  AND "schedule_status" NOT IN ('cancelled', 'rescheduled');

CREATE UNIQUE INDEX "VisitScheduleProposal_open_route_order_key"
ON "VisitScheduleProposal"("org_id", "proposed_pharmacist_id", "proposed_date", "route_order")
WHERE "route_order" IS NOT NULL
  AND "finalized_schedule_id" IS NULL
  AND "proposal_status" IN ('proposed', 'patient_contact_pending', 'reschedule_pending');
