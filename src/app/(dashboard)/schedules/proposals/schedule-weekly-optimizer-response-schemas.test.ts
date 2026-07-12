import { describe, expect, it } from 'vitest';

import {
  buildWeeklyOptimizerCasesResponseSchema,
  buildWeeklyOptimizerProposalsResponseSchema,
  buildWeeklyOptimizerShiftsResponseSchema,
  weeklyOptimizerBillingPreviewResponseSchema,
} from './schedule-weekly-optimizer-response-schemas';

const at = '2026-04-09T00:00:00.000Z';

function proposal() {
  return {
    id: 'proposal_1',
    display_id: 'vsp0000000001',
    case_id: 'case_1',
    visit_type: 'regular',
    priority: 'normal',
    proposal_status: 'proposed',
    patient_contact_status: 'pending',
    proposed_date: '2026-04-09',
    time_window_start: '2026-04-09T09:00:00.000Z',
    time_window_end: '2026-04-09T10:00:00.000Z',
    proposed_pharmacist_id: 'user_1',
    proposed_pharmacist: { id: 'user_1', name: '薬剤師A', name_kana: null },
    assignment_mode: 'primary',
    route_order: 1,
    route_distance_score: 1,
    updated_at: at,
    medication_end_date: null,
    visit_deadline_date: null,
    proposal_reason: '定期訪問',
    escalation_reason: null,
    finalized_schedule_id: null,
    reschedule_source_schedule_id: null,
    case_: {
      patient: {
        id: 'patient_1',
        name: '患者A',
        residences: [{ address: '東京都' }],
      },
    },
    site: null,
    vehicle_resource: null,
    finalized_schedule: null,
    reschedule_source_schedule: null,
    contact_logs: [],
  };
}

function billingPreview() {
  return {
    data: {
      alerts: [],
      cadence: {
        monthly_cap: 4,
        current_month_count: 1,
        remaining_month_count: 3,
        weekly_cap: 1,
        current_week_count: 0,
        scheduled_dates_current_month: [],
        next_billable_date: null,
        suggested_dates: [],
        reason: '算定可能',
      },
      recommended_visit_type: 'regular',
      recommended_priority: 'normal',
      suggested_schedule_slot_count: 3,
      effective_revision_code: '2026',
      effective_revision_label: '2026年度',
      site_config_status: 'resolved',
      site_config_revision_code: '2026',
      warnings: [],
      home_comprehensive_preview: null,
    },
  };
}

describe('weekly optimizer response schemas', () => {
  it('validates active case scope, identity, and cursor semantics', () => {
    const schema = buildWeeklyOptimizerCasesResponseSchema({ limit: 8, status: 'active' });
    const payload = {
      data: [
        {
          id: 'case_1',
          status: 'active',
          primary_pharmacist_id: 'user_1',
          primary_pharmacist_name: '薬剤師A',
          patient: { id: 'patient_1', name: '患者A', residences: [] },
        },
      ],
      meta: { limit: 8, has_more: false, next_cursor: null },
    };
    expect(schema.safeParse(payload).success).toBe(true);
    expect(
      schema.safeParse({ ...payload, data: [{ ...payload.data[0], status: 'closed' }] }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ ...payload, meta: { ...payload.meta, has_more: true } }).success,
    ).toBe(false);
  });

  it('rejects proposals outside the requested week or with relation drift', () => {
    const schema = buildWeeklyOptimizerProposalsResponseSchema('2026-04-06', '2026-04-12');
    expect(schema.safeParse({ data: [proposal()] }).success).toBe(true);
    expect(
      schema.safeParse({ data: [{ ...proposal(), proposed_date: '2026-04-13' }] }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        data: [
          {
            ...proposal(),
            proposed_pharmacist: { id: 'user_other', name: '薬剤師B', name_kana: null },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects cross-week or duplicate pharmacist shifts', () => {
    const schema = buildWeeklyOptimizerShiftsResponseSchema('2026-04-06', '2026-04-12');
    const shift = {
      id: 'shift_1',
      user_id: 'user_1',
      site_id: 'site_1',
      date: at,
      available: true,
      available_from: null,
      available_to: null,
      user: { id: 'user_1', name: '薬剤師A', name_kana: null },
      site: { id: 'site_1', name: '本店' },
    };
    expect(schema.safeParse({ data: [shift] }).success).toBe(true);
    expect(schema.safeParse({ data: [shift, { ...shift, id: 'shift_2' }] }).success).toBe(false);
    expect(
      schema.safeParse({ data: [{ ...shift, date: '2026-04-13T00:00:00.000Z' }] }).success,
    ).toBe(false);
  });

  it('requires the complete billing preview contract', () => {
    expect(weeklyOptimizerBillingPreviewResponseSchema.safeParse(billingPreview()).success).toBe(
      true,
    );
    const invalid = billingPreview();
    delete (invalid.data as Partial<typeof invalid.data>).effective_revision_code;
    expect(weeklyOptimizerBillingPreviewResponseSchema.safeParse(invalid).success).toBe(false);
  });
});
