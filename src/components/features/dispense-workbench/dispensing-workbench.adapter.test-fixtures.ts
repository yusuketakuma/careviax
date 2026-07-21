export function calendarBody() {
  return {
    data: {
      plan_id: 'plan_1',
      cycle_id: 'cycle_1',
      cycle_version: 3,
      cycle_status: 'setting',
      set_method: 'facility_calendar',
      period_start: '2026-06-17',
      period_end: '2026-06-17',
      day_count: 1,
      slots: ['morning', 'noon', 'evening', 'bedtime', 'prn'],
      rows: [
        {
          line: {
            id: 'line_1',
            drug_name: 'アムロジピン錠5mg',
            dose: '1錠',
            frequency: '朝食後',
            unit: '錠',
          },
          days: [
            {
              day_number: 1,
              date: '2026-06-17',
              cells: {
                morning: {
                  batch_id: 'batch_1',
                  state: 'set',
                  quantity: 1,
                  carry_type: 'carry',
                  set_state: 'set',
                  audit_state: 'pending',
                  ng_code: null,
                  held_reason: null,
                  version: 5,
                },
                noon: emptyCell(),
                evening: emptyCell(),
                bedtime: emptyCell(),
                prn: emptyCell(),
              },
            },
          ],
        },
      ],
      completion_gate: {
        total_cells: 1,
        set_cells: 1,
        pending_cells: 0,
        hold_cells: 0,
        audited_ok_cells: 0,
        audited_ng_cells: 0,
        unaudited_cells: 1,
        set_complete: true,
        audit_complete: false,
      },
    },
  };
}

export function workbenchBody() {
  return {
    task: { id: 'task_1', status: 'in_progress', priority: 'normal', due_date: null },
    cycle: { id: 'cycle_1', overall_status: 'dispensing', version: 2 },
    patient: { id: 'patient_1', name: '佐藤 花子' },
    intake: {
      id: 'intake_1',
      prescribed_date: '2026-06-17',
      prescriber_institution: 'さくら内科',
      prescriber_name: '田中 一郎',
    },
    previous_intake: null,
    safety: {
      allergy: null,
      renal: null,
      handling_tags: [],
      swallowing: null,
      cautions: [],
    },
    comparison: [],
    count_rows: [],
    dispenser: null,
    auditor: null,
    is_self_audit: false,
    has_narcotic: false,
    visit_time_label: null,
    resolved_inquiry: null,
    team_audit_total: 0,
    stock_check_date_label: null,
  };
}

function emptyCell() {
  return {
    batch_id: null,
    state: 'empty',
    quantity: null,
    carry_type: null,
    set_state: null,
    audit_state: null,
    ng_code: null,
    held_reason: null,
    version: null,
  };
}

export function patientListBody(
  data: unknown[] = [],
  overrides: Record<string, unknown> = {},
  filterOverrides: Record<string, unknown> = {},
) {
  return {
    data: data.map((row) => ({
      representative_task_id: null,
      representative_task_status: null,
      ...(row as Record<string, unknown>),
    })),
    meta: {
      generated_at: '2026-07-06T00:00:00.000Z',
      limit: 50,
      returned_count: data.length,
      has_more: false,
      next_cursor: null,
      total_count: data.length,
      count_basis: {
        rows: 'authorized_latest_cycle_per_patient',
        total_count: 'authorized_phase_search_exact',
        phase_counts: 'authorized_phase_search_exact',
        set_split: 'latest_set_plan_set_batch_exact',
      },
      filters_applied: {
        phase: null,
        q_present: false,
        sort: 'name_kana',
        order: 'asc',
        include_set_plan: false,
        ...filterOverrides,
      },
      facets: {
        total: data.length,
        phase_counts: { dispense: data.length, audit: 0, set: 0, 'set-audit': 0 },
        other: 0,
      },
      ...overrides,
    },
  };
}
