export const SCHEDULE_LIST_INCLUDE = {
  visit_record: { select: { id: true, outcome_status: true } },
  facility_batch: {
    select: {
      id: true,
    },
  },
  preparation: {
    select: {
      id: true,
      prepared_at: true,
      medication_changes_reviewed: true,
      carry_items_confirmed: true,
      previous_issues_reviewed: true,
      route_confirmed: true,
      offline_synced: true,
      checklist: true,
    },
  },
  override_request: {
    select: {
      id: true,
      status: true,
      reason: true,
      requested_at: true,
      approved_at: true,
      approved_by: true,
      impact_summary: true,
    },
  },
  applied_override: {
    select: {
      id: true,
      reason: true,
      requested_at: true,
      approved_at: true,
      source_schedule: {
        select: {
          id: true,
          scheduled_date: true,
          time_window_start: true,
          time_window_end: true,
          pharmacist_id: true,
        },
      },
    },
  },
  case_: {
    select: {
      primary_pharmacist_id: true,
      backup_pharmacist_id: true,
      patient: {
        select: {
          id: true,
          name: true,
          residences: {
            where: { is_primary: true },
            select: {
              address: true,
              building_id: true,
              unit_name: true,
              lat: true,
              lng: true,
            },
            take: 1,
          },
        },
      },
    },
  },
  site: {
    select: {
      id: true,
      name: true,
      address: true,
      lat: true,
      lng: true,
    },
  },
} as const;

export const SCHEDULE_DETAIL_INCLUDE = {
  ...SCHEDULE_LIST_INCLUDE,
  visit_record: true,
  preparation: true,
  override_request: true,
  applied_override: true,
  case_: {
    select: {
      primary_pharmacist_id: true,
      backup_pharmacist_id: true,
      patient: {
        select: {
          id: true,
          name: true,
          residences: {
            where: { is_primary: true },
            select: {
              address: true,
              building_id: true,
              unit_name: true,
              lat: true,
              lng: true,
            },
            take: 1,
          },
        },
      },
    },
  },
  site: {
    select: {
      id: true,
      name: true,
      address: true,
      lat: true,
      lng: true,
    },
  },
} as const;
