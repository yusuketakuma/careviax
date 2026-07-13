import { describe, expect, it } from 'vitest';
import {
  buildScheduleProposalBillingPreviewBatchResponseSchema,
  buildScheduleProposalDetailResponseSchema,
  buildScheduleProposalsDashboardResponseSchema,
  scheduleProposalCaseSearchResponseSchema,
  scheduleProposalVehicleResourcesResponseSchema,
} from './schedule-proposals-response-schemas';

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'proposal_1',
    case_id: 'case_1',
    visit_type: 'regular',
    priority: 'normal',
    proposal_status: 'proposed',
    patient_contact_status: 'pending',
    proposed_date: '2026-07-13',
    time_window_start: '2026-07-13T09:00:00.000Z',
    time_window_end: '2026-07-13T10:00:00.000Z',
    proposed_pharmacist_id: 'pharmacist_1',
    proposed_pharmacist: { id: 'pharmacist_1', name: '薬剤師A', name_kana: null },
    assignment_mode: 'primary',
    route_order: 1,
    route_distance_score: 1.2,
    updated_at: '2026-07-13T08:00:00.000Z',
    medication_end_date: null,
    visit_deadline_date: '2026-07-14',
    proposal_reason: '訪問候補',
    escalation_reason: null,
    finalized_schedule_id: null,
    reschedule_source_schedule_id: null,
    case_: {
      patient: {
        id: 'patient_1',
        name: '患者A',
        residences: [{ address: '東京都', lat: 35, lng: 139 }],
      },
    },
    site: { id: 'site_1', name: '本店', address: '東京都', lat: 35, lng: 139 },
    vehicle_resource: null,
    finalized_schedule: null,
    reschedule_source_schedule: null,
    contact_logs: [],
    ...overrides,
  };
}

function billingPreview() {
  return {
    alerts: [],
    cadence: {
      monthly_cap: 4,
      current_month_count: 1,
      remaining_month_count: 3,
      weekly_cap: null,
      current_week_count: 1,
      scheduled_dates_current_month: ['2026-07-13'],
      next_billable_date: null,
      suggested_dates: [],
      reason: '算定可能',
    },
    recommended_visit_type: 'regular',
    recommended_priority: 'normal',
    suggested_schedule_slot_count: 1,
    effective_revision_code: 'rev_2026',
    effective_revision_label: '2026年度',
    site_config_status: 'resolved',
    site_config_revision_code: 'rev_2026',
    warnings: [],
    home_comprehensive_preview: null,
  };
}

describe('schedule proposals response schemas', () => {
  it('validates dashboard request scope and duplicate proposal identities', () => {
    const schema = buildScheduleProposalsDashboardResponseSchema({
      caseId: 'case_1',
      patientId: 'patient_1',
      dateFrom: '2026-07-13',
      dateTo: '2026-07-13',
      status: null,
    });
    expect(schema.parse({ data: [proposal()] }).data).toHaveLength(1);
    expect(() => schema.parse({ data: [proposal(), proposal()] })).toThrow('duplicate proposal');
    expect(() => schema.parse({ data: [proposal({ case_id: 'case_2' })] })).toThrow(
      'proposal outside requested dashboard scope',
    );
  });

  it('validates active case search and strips provider-only patient metadata', () => {
    const result = scheduleProposalCaseSearchResponseSchema.parse({
      data: [
        {
          id: 'case_1',
          display_id: 'cc0000000001',
          status: 'active',
          primary_pharmacist_id: 'pharmacist_1',
          primary_pharmacist_name: '薬剤師A',
          patient: {
            id: 'patient_1',
            name: '患者A',
            phone: 'removed',
            residences: [{ address: '東京都', lat: 35, lng: 139 }],
          },
        },
      ],
      meta: { limit: 8, has_more: false, next_cursor: null },
    });
    expect(result.data[0]?.patient).not.toHaveProperty('phone');
  });

  it('validates available vehicle resource counts and filter context', () => {
    const valid = {
      data: [
        {
          id: 'vehicle_1',
          label: '社用車A',
          travel_mode: 'DRIVE',
          max_stops: 6,
          max_route_duration_minutes: 180,
          available: true,
          site: { id: 'site_1', name: '本店' },
          notes: 'removed',
        },
      ],
      meta: {
        total_count: 1,
        visible_count: 1,
        hidden_count: 0,
        truncated: false,
        count_basis: 'visit_vehicle_resources',
        filters_applied: { available: true },
        limit: 100,
      },
    } as const;
    expect(scheduleProposalVehicleResourcesResponseSchema.parse(valid).data[0]).not.toHaveProperty(
      'notes',
    );
    expect(() =>
      scheduleProposalVehicleResourcesResponseSchema.parse({
        ...valid,
        meta: { ...valid.meta, visible_count: 0 },
      }),
    ).toThrow('vehicle resource count mismatch');
  });

  it('requires billing preview keys to exactly match requested proposals', () => {
    const schema = buildScheduleProposalBillingPreviewBatchResponseSchema([
      'proposal_1',
      'proposal_2',
    ]);
    expect(
      schema.parse({ data: { proposal_1: billingPreview(), proposal_2: billingPreview() } }),
    ).toBeInstanceOf(Map);
    expect(() => schema.parse({ data: { proposal_1: billingPreview() } })).toThrow(
      'billing preview key mismatch',
    );
  });

  it('validates detail identity, travel mode, and related identity uniqueness', () => {
    const detail = {
      ...proposal(),
      approved_at: null,
      patient_contacted_at: null,
      confirmed_at: null,
      related_proposals: [],
      pharmacist_day_schedules: [],
      route_preview: {
        plan: {
          status: 'unavailable',
          note: null,
          travelMode: 'DRIVE',
          origin: null,
          encodedPath: null,
          orderedScheduleIds: [],
          totalDistanceMeters: null,
          totalDurationSeconds: null,
          stopSummaries: [],
        },
        points: [],
        site: null,
      },
      creation_diagnostics: null,
    };
    expect(
      buildScheduleProposalDetailResponseSchema('proposal_1', 'DRIVE').parse({ data: detail }).data
        .id,
    ).toBe('proposal_1');
    expect(() =>
      buildScheduleProposalDetailResponseSchema('proposal_1', 'WALK').parse({ data: detail }),
    ).toThrow('proposal detail scope mismatch');
    expect(() =>
      buildScheduleProposalDetailResponseSchema('proposal_1', 'DRIVE').parse({
        data: { ...detail, related_proposals: [proposal()] },
      }),
    ).toThrow('duplicate related proposal');
  });
});
