import { beforeEach, describe, expect, it, vi } from 'vitest';
import { format } from 'date-fns';

const {
  careCaseFindFirstMock,
  medicationCycleFindFirstMock,
  pharmacistShiftFindManyMock,
  businessHolidayFindManyMock,
  visitScheduleFindManyMock,
  evaluateVisitWorkflowGateMock,
} = vi.hoisted(() => ({
  careCaseFindFirstMock: vi.fn(),
  medicationCycleFindFirstMock: vi.fn(),
  pharmacistShiftFindManyMock: vi.fn(),
  businessHolidayFindManyMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  evaluateVisitWorkflowGateMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    careCase: {
      findFirst: careCaseFindFirstMock,
    },
    medicationCycle: {
      findFirst: medicationCycleFindFirstMock,
    },
    pharmacistShift: {
      findMany: pharmacistShiftFindManyMock,
    },
    businessHoliday: {
      findMany: businessHolidayFindManyMock,
    },
    visitSchedule: {
      findMany: visitScheduleFindManyMock,
    },
  },
}));

vi.mock('./management-plans', () => ({
  evaluateVisitWorkflowGate: evaluateVisitWorkflowGateMock,
}));

const { createRoadTravelEstimatorMock } = vi.hoisted(() => ({
  createRoadTravelEstimatorMock: vi.fn(() => async () => null),
}));

vi.mock('./road-routing', () => ({
  createRoadTravelEstimator: createRoadTravelEstimatorMock,
}));

import { generateVisitScheduleProposalDrafts } from './visit-schedule-planner';

describe('generateVisitScheduleProposalDrafts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createRoadTravelEstimatorMock.mockReturnValue(async () => null);

    careCaseFindFirstMock.mockResolvedValue({
      id: 'case_1',
      patient_id: 'patient_1',
      primary_pharmacist_id: 'pharmacist_primary',
      backup_pharmacist_id: 'pharmacist_backup',
      patient: {
        scheduling_preference: null,
        residences: [
          {
            address: '東京都港区1-1-1',
            lat: 35.0,
            lng: 139.0,
            building_id: 'facility_a',
          },
        ],
      },
    });
    medicationCycleFindFirstMock.mockResolvedValue({
      id: 'cycle_1',
      prescription_intakes: [],
    });
    pharmacistShiftFindManyMock.mockResolvedValue([
      {
        date: new Date('2026-03-28T00:00:00.000Z'),
        available_from: new Date(1970, 0, 1, 9, 0, 0, 0),
        available_to: new Date(1970, 0, 1, 18, 0, 0, 0),
        available: true,
        user_id: 'pharmacist_primary',
        site_id: 'site_1',
        user: {
          id: 'pharmacist_primary',
          name: '主担当薬剤師',
          max_daily_visits: null,
          max_weekly_visits: null,
          max_travel_minutes: null,
          can_accept_emergency: true,
          visit_specialties: [],
        },
        site: {
          id: 'site_1',
          name: '本店',
          address: '東京都港区2-2-2',
          lat: 35.01,
          lng: 139.01,
        },
      },
      {
        date: new Date('2026-03-28T00:00:00.000Z'),
        available_from: new Date(1970, 0, 1, 9, 0, 0, 0),
        available_to: new Date(1970, 0, 1, 18, 0, 0, 0),
        available: true,
        user_id: 'pharmacist_backup',
        site_id: 'site_1',
        user: {
          id: 'pharmacist_backup',
          name: '副担当薬剤師',
          max_daily_visits: null,
          max_weekly_visits: null,
          max_travel_minutes: null,
          can_accept_emergency: true,
          visit_specialties: [],
        },
        site: {
          id: 'site_1',
          name: '本店',
          address: '東京都港区2-2-2',
          lat: 35.01,
          lng: 139.01,
        },
      },
    ]);
    businessHolidayFindManyMock.mockResolvedValue([]);
    visitScheduleFindManyMock.mockResolvedValue([]);
    evaluateVisitWorkflowGateMock.mockResolvedValue({
      ok: true,
      issues: [],
    });
  });

  it('prefers the primary pharmacist and explains the care-first decision', async () => {
    const result = await generateVisitScheduleProposalDrafts({
      orgId: 'org_1',
      caseId: 'case_1',
      visitType: 'regular',
      priority: 'normal',
      candidateCount: 1,
      startDate: new Date('2026-03-27T00:00:00.000Z'),
    });

    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]).toMatchObject({
      proposed_pharmacist_id: 'pharmacist_primary',
      assignment_mode: 'primary',
    });
    expect(result.drafts[0].proposal_reason).toContain('主担当薬剤師を優先');
    expect(result.diagnostics.accepted[0]?.pharmacist_id).toBe('pharmacist_primary');
  });

  it('keeps route orders scoped to each pharmacist and day cell', async () => {
    const result = await generateVisitScheduleProposalDrafts({
      orgId: 'org_1',
      caseId: 'case_1',
      visitType: 'regular',
      priority: 'normal',
      candidateCount: 2,
      startDate: new Date('2026-03-27T00:00:00.000Z'),
    });

    expect(result.drafts).toHaveLength(2);
    const primaryDraft = result.drafts.find(
      (draft) => draft.proposed_pharmacist_id === 'pharmacist_primary',
    );
    const backupDraft = result.drafts.find(
      (draft) => draft.proposed_pharmacist_id === 'pharmacist_backup',
    );

    expect(primaryDraft?.route_order).toBe(1);
    expect(backupDraft?.route_order).toBe(1);
    expect(result.diagnostics.accepted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pharmacist_id: 'pharmacist_primary',
          route_order: 1,
        }),
        expect.objectContaining({
          pharmacist_id: 'pharmacist_backup',
          route_order: 1,
        }),
      ]),
    );
  });

  it('emits reason_code=evaluation_error when candidate evaluation throws unexpectedly', async () => {
    createRoadTravelEstimatorMock.mockReturnValue(() => {
      throw new Error('simulated upstream failure');
    });

    const result = await generateVisitScheduleProposalDrafts({
      orgId: 'org_1',
      caseId: 'case_1',
      visitType: 'regular',
      priority: 'normal',
      candidateCount: 3,
      startDate: new Date('2026-03-27T00:00:00.000Z'),
    });

    // All shifts should be rejected with evaluation_error, not travel_limit
    expect(result.diagnostics.rejected.length).toBeGreaterThan(0);
    for (const rejected of result.diagnostics.rejected) {
      expect(rejected.reason_code).toBe('evaluation_error');
      expect(rejected.reason_label).toBe('評価エラー');
      expect(rejected.detail).toContain('評価中にエラーが発生しました');
    }
    // travel_limit must NOT appear in any rejection
    const travelLimitRejections = result.diagnostics.rejected.filter(
      (r) => r.reason_code === 'travel_limit',
    );
    expect(travelLimitRejections).toHaveLength(0);
  });

  it('returns rejected diagnostics when the primary pharmacist is at daily capacity', async () => {
    pharmacistShiftFindManyMock.mockResolvedValueOnce([
      {
        date: new Date('2026-03-28T00:00:00.000Z'),
        available_from: new Date(1970, 0, 1, 9, 0, 0, 0),
        available_to: new Date(1970, 0, 1, 18, 0, 0, 0),
        available: true,
        user_id: 'pharmacist_primary',
        site_id: 'site_1',
        user: {
          id: 'pharmacist_primary',
          name: '主担当薬剤師',
          max_daily_visits: 1,
          max_weekly_visits: null,
          max_travel_minutes: null,
          can_accept_emergency: true,
          visit_specialties: [],
        },
        site: {
          id: 'site_1',
          name: '本店',
          address: '東京都港区2-2-2',
          lat: 35.01,
          lng: 139.01,
        },
      },
      {
        date: new Date('2026-03-28T00:00:00.000Z'),
        available_from: new Date(1970, 0, 1, 9, 0, 0, 0),
        available_to: new Date(1970, 0, 1, 18, 0, 0, 0),
        available: true,
        user_id: 'pharmacist_backup',
        site_id: 'site_1',
        user: {
          id: 'pharmacist_backup',
          name: '副担当薬剤師',
          max_daily_visits: null,
          max_weekly_visits: null,
          max_travel_minutes: null,
          can_accept_emergency: true,
          visit_specialties: [],
        },
        site: {
          id: 'site_1',
          name: '本店',
          address: '東京都港区2-2-2',
          lat: 35.01,
          lng: 139.01,
        },
      },
    ]);
    visitScheduleFindManyMock.mockResolvedValueOnce([
      {
        pharmacist_id: 'pharmacist_primary',
        route_order: 1,
        scheduled_date: new Date('2026-03-28T00:00:00.000Z'),
        time_window_start: new Date(1970, 0, 1, 9, 0, 0, 0),
        time_window_end: new Date(1970, 0, 1, 10, 0, 0, 0),
        schedule_status: 'planned',
        case_: {
          patient: {
            id: 'other',
            residences: [{ address: '東京都港区3-3-3', lat: 35.02, lng: 139.02 }],
          },
        },
        site: {
          address: '東京都港区2-2-2',
          lat: 35.01,
          lng: 139.01,
        },
      },
    ]);

    const result = await generateVisitScheduleProposalDrafts({
      orgId: 'org_1',
      caseId: 'case_1',
      visitType: 'regular',
      priority: 'normal',
      candidateCount: 1,
      startDate: new Date('2026-03-27T00:00:00.000Z'),
    });

    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]?.proposed_pharmacist_id).toBe('pharmacist_backup');
    expect(result.diagnostics.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pharmacist_id: 'pharmacist_primary',
          reason_code: 'daily_capacity',
        }),
      ]),
    );
  });

  it('rejects visit candidates after the day before the latest medication end date', async () => {
    medicationCycleFindFirstMock.mockResolvedValueOnce({
      id: 'cycle_1',
      prescription_intakes: [
        {
          refill_next_dispense_date: null,
          lines: [{ end_date: new Date('2026-03-30T00:00:00.000Z') }],
        },
      ],
    });
    pharmacistShiftFindManyMock.mockResolvedValueOnce([
      {
        date: new Date('2026-03-29T00:00:00.000Z'),
        available_from: new Date(1970, 0, 1, 9, 0, 0, 0),
        available_to: new Date(1970, 0, 1, 18, 0, 0, 0),
        available: true,
        user_id: 'pharmacist_primary',
        site_id: 'site_1',
        user: {
          id: 'pharmacist_primary',
          name: '主担当薬剤師',
          max_daily_visits: null,
          max_weekly_visits: null,
          max_travel_minutes: null,
          can_accept_emergency: true,
          visit_specialties: [],
        },
        site: {
          id: 'site_1',
          name: '本店',
          address: '東京都港区2-2-2',
          lat: 35.01,
          lng: 139.01,
        },
      },
      {
        date: new Date('2026-03-30T00:00:00.000Z'),
        available_from: new Date(1970, 0, 1, 9, 0, 0, 0),
        available_to: new Date(1970, 0, 1, 18, 0, 0, 0),
        available: true,
        user_id: 'pharmacist_backup',
        site_id: 'site_1',
        user: {
          id: 'pharmacist_backup',
          name: '副担当薬剤師',
          max_daily_visits: null,
          max_weekly_visits: null,
          max_travel_minutes: null,
          can_accept_emergency: true,
          visit_specialties: [],
        },
        site: {
          id: 'site_1',
          name: '本店',
          address: '東京都港区2-2-2',
          lat: 35.01,
          lng: 139.01,
        },
      },
    ]);

    const result = await generateVisitScheduleProposalDrafts({
      orgId: 'org_1',
      caseId: 'case_1',
      visitType: 'regular',
      priority: 'normal',
      candidateCount: 1,
      startDate: new Date('2026-03-27T00:00:00.000Z'),
    });

    expect(result.drafts[0]).toMatchObject({
      medication_end_date: new Date('2026-03-30T00:00:00.000Z'),
      visit_deadline_date: new Date('2026-03-29T00:00:00.000Z'),
      proposed_date: new Date('2026-03-29T00:00:00.000Z'),
    });
    expect(result.diagnostics.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pharmacist_id: 'pharmacist_backup',
          reason_code: 'beyond_deadline',
          detail: '訪問期限 2026-03-29 を超えるため候補外です',
        }),
      ]),
    );
  });

  it('treats a preferred primary pharmacist as a priority, not a hard filter', async () => {
    pharmacistShiftFindManyMock.mockResolvedValueOnce([
      {
        date: new Date('2026-03-28T00:00:00.000Z'),
        available_from: new Date(1970, 0, 1, 9, 0, 0, 0),
        available_to: new Date(1970, 0, 1, 18, 0, 0, 0),
        available: true,
        user_id: 'pharmacist_backup',
        site_id: 'site_1',
        user: {
          id: 'pharmacist_backup',
          name: '副担当薬剤師',
          max_daily_visits: null,
          max_weekly_visits: null,
          max_travel_minutes: null,
          can_accept_emergency: true,
          visit_specialties: [],
        },
        site: {
          id: 'site_1',
          name: '本店',
          address: '東京都港区2-2-2',
          lat: 35.01,
          lng: 139.01,
        },
      },
    ]);

    const result = await generateVisitScheduleProposalDrafts({
      orgId: 'org_1',
      caseId: 'case_1',
      visitType: 'regular',
      priority: 'normal',
      candidateCount: 1,
      startDate: new Date('2026-03-27T00:00:00.000Z'),
      preferredPharmacistId: 'pharmacist_primary',
    });

    expect(pharmacistShiftFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({
          user_id: 'pharmacist_primary',
        }),
      }),
    );
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]).toMatchObject({
      proposed_pharmacist_id: 'pharmacist_backup',
      assignment_mode: 'fallback',
      escalation_reason: '担当薬剤師の勤務枠が見つからなかったため代替薬剤師を割り当て',
    });
    expect(result.drafts[0]?.proposal_reason).toContain('希望担当薬剤師を優先考慮');
  });

  it('keeps the patient visit buffer around existing same-day schedules', async () => {
    careCaseFindFirstMock.mockResolvedValueOnce({
      id: 'case_1',
      patient_id: 'patient_1',
      primary_pharmacist_id: 'pharmacist_primary',
      backup_pharmacist_id: null,
      patient: {
        scheduling_preference: {
          preferred_weekdays: [],
          preferred_time_from: new Date(1970, 0, 1, 9, 0, 0, 0),
          preferred_time_to: new Date(1970, 0, 1, 12, 0, 0, 0),
          facility_time_from: null,
          facility_time_to: null,
          family_presence_required: false,
          visit_buffer_minutes: 30,
        },
        residences: [
          {
            address: '東京都港区1-1-1',
            lat: 35.0,
            lng: 139.0,
            building_id: 'facility_a',
          },
        ],
      },
    });
    pharmacistShiftFindManyMock.mockResolvedValueOnce([
      {
        date: new Date('2026-03-28T00:00:00.000Z'),
        available_from: new Date(1970, 0, 1, 9, 0, 0, 0),
        available_to: new Date(1970, 0, 1, 12, 0, 0, 0),
        available: true,
        user_id: 'pharmacist_primary',
        site_id: 'site_1',
        user: {
          id: 'pharmacist_primary',
          name: '主担当薬剤師',
          max_daily_visits: null,
          max_weekly_visits: null,
          max_travel_minutes: null,
          can_accept_emergency: true,
          visit_specialties: [],
        },
        site: {
          id: 'site_1',
          name: '本店',
          address: '東京都港区2-2-2',
          lat: 35.01,
          lng: 139.01,
        },
      },
    ]);
    visitScheduleFindManyMock.mockResolvedValueOnce([
      {
        pharmacist_id: 'pharmacist_primary',
        route_order: 1,
        scheduled_date: new Date('2026-03-28T00:00:00.000Z'),
        time_window_start: new Date(1970, 0, 1, 9, 0, 0, 0),
        time_window_end: new Date(1970, 0, 1, 10, 0, 0, 0),
        schedule_status: 'planned',
        confirmed_at: null,
        case_: {
          patient: {
            id: 'other',
            residences: [{ address: '東京都港区3-3-3', lat: 35.02, lng: 139.02 }],
          },
        },
        site: {
          address: '東京都港区2-2-2',
          lat: 35.01,
          lng: 139.01,
        },
      },
    ]);

    const result = await generateVisitScheduleProposalDrafts({
      orgId: 'org_1',
      caseId: 'case_1',
      visitType: 'regular',
      priority: 'normal',
      candidateCount: 1,
      startDate: new Date('2026-03-27T00:00:00.000Z'),
    });

    expect(result.drafts).toHaveLength(1);
    expect(format(result.drafts[0]!.time_window_start!, 'HH:mm')).toBe('10:30');
    expect(format(result.drafts[0]!.time_window_end!, 'HH:mm')).toBe('11:30');
    expect(result.drafts[0]?.proposal_reason).toContain('訪問前後バッファ 30分を反映');
  });

  it('keeps existing schedule patient buffers even when the target patient has no buffer', async () => {
    careCaseFindFirstMock.mockResolvedValueOnce({
      id: 'case_1',
      patient_id: 'patient_1',
      primary_pharmacist_id: 'pharmacist_primary',
      backup_pharmacist_id: null,
      patient: {
        scheduling_preference: {
          preferred_weekdays: [],
          preferred_time_from: new Date(1970, 0, 1, 9, 0, 0, 0),
          preferred_time_to: new Date(1970, 0, 1, 12, 0, 0, 0),
          facility_time_from: null,
          facility_time_to: null,
          family_presence_required: false,
          visit_buffer_minutes: 0,
        },
        residences: [
          {
            address: '東京都港区1-1-1',
            lat: 35.0,
            lng: 139.0,
            building_id: 'facility_a',
          },
        ],
      },
    });
    pharmacistShiftFindManyMock.mockResolvedValueOnce([
      {
        date: new Date('2026-03-28T00:00:00.000Z'),
        available_from: new Date(1970, 0, 1, 9, 0, 0, 0),
        available_to: new Date(1970, 0, 1, 12, 0, 0, 0),
        available: true,
        user_id: 'pharmacist_primary',
        site_id: 'site_1',
        user: {
          id: 'pharmacist_primary',
          name: '主担当薬剤師',
          max_daily_visits: null,
          max_weekly_visits: null,
          max_travel_minutes: null,
          can_accept_emergency: true,
          visit_specialties: [],
        },
        site: {
          id: 'site_1',
          name: '本店',
          address: '東京都港区2-2-2',
          lat: 35.01,
          lng: 139.01,
        },
      },
    ]);
    visitScheduleFindManyMock.mockResolvedValueOnce([
      {
        pharmacist_id: 'pharmacist_primary',
        route_order: 1,
        scheduled_date: new Date('2026-03-28T00:00:00.000Z'),
        time_window_start: new Date(1970, 0, 1, 9, 0, 0, 0),
        time_window_end: new Date(1970, 0, 1, 10, 0, 0, 0),
        schedule_status: 'planned',
        confirmed_at: null,
        case_: {
          patient: {
            id: 'other',
            residences: [{ address: '東京都港区3-3-3', lat: 35.02, lng: 139.02 }],
            scheduling_preference: {
              visit_buffer_minutes: 60,
            },
          },
        },
        site: {
          address: '東京都港区2-2-2',
          lat: 35.01,
          lng: 139.01,
        },
      },
    ]);

    const result = await generateVisitScheduleProposalDrafts({
      orgId: 'org_1',
      caseId: 'case_1',
      visitType: 'regular',
      priority: 'normal',
      candidateCount: 1,
      startDate: new Date('2026-03-27T00:00:00.000Z'),
    });

    expect(result.drafts).toHaveLength(1);
    expect(format(result.drafts[0]!.time_window_start!, 'HH:mm')).toBe('11:00');
    expect(format(result.drafts[0]!.time_window_end!, 'HH:mm')).toBe('12:00');
  });
});
