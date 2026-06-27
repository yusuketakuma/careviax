import { beforeEach, describe, expect, it, vi } from 'vitest';
import { format } from 'date-fns';

const {
  careCaseFindFirstMock,
  medicationCycleFindFirstMock,
  pharmacistShiftFindManyMock,
  businessHolidayFindManyMock,
  visitScheduleFindManyMock,
  visitVehicleResourceFindManyMock,
  evaluateVisitWorkflowGateMock,
} = vi.hoisted(() => ({
  careCaseFindFirstMock: vi.fn(),
  medicationCycleFindFirstMock: vi.fn(),
  pharmacistShiftFindManyMock: vi.fn(),
  businessHolidayFindManyMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  visitVehicleResourceFindManyMock: vi.fn(),
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
    visitVehicleResource: {
      findMany: visitVehicleResourceFindManyMock,
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
        available_from: new Date(Date.UTC(1970, 0, 1, 9, 0, 0, 0)),
        available_to: new Date(Date.UTC(1970, 0, 1, 18, 0, 0, 0)),
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
        available_from: new Date(Date.UTC(1970, 0, 1, 9, 0, 0, 0)),
        available_to: new Date(Date.UTC(1970, 0, 1, 18, 0, 0, 0)),
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
    visitVehicleResourceFindManyMock.mockResolvedValue([
      {
        id: 'vehicle_1',
        site_id: 'site_1',
        label: '社用車A',
        travel_mode: 'DRIVE',
        max_stops: 8,
      },
    ]);
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

  it('rejects every candidate on an org-wide business holiday', async () => {
    businessHolidayFindManyMock.mockResolvedValueOnce([
      {
        date: new Date('2026-03-28T00:00:00.000Z'),
        site_id: null,
        is_closed: true,
      },
    ]);

    const result = await generateVisitScheduleProposalDrafts({
      orgId: 'org_1',
      caseId: 'case_1',
      visitType: 'regular',
      priority: 'normal',
      candidateCount: 2,
      startDate: new Date('2026-03-27T00:00:00.000Z'),
    });

    expect(result.drafts).toHaveLength(0);
    expect(result.diagnostics.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pharmacist_id: 'pharmacist_primary',
          site_id: 'site_1',
          reason_code: 'business_holiday',
          detail: '拠点休業日のため候補外です',
        }),
        expect.objectContaining({
          pharmacist_id: 'pharmacist_backup',
          site_id: 'site_1',
          reason_code: 'business_holiday',
          detail: '拠点休業日のため候補外です',
        }),
      ]),
    );
    expect(businessHolidayFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          is_closed: true,
        }),
      }),
    );
  });

  it('rejects only matching-site candidates on a site-specific business holiday', async () => {
    pharmacistShiftFindManyMock.mockResolvedValueOnce([
      {
        date: new Date('2026-03-28T00:00:00.000Z'),
        available_from: new Date(Date.UTC(1970, 0, 1, 9, 0, 0, 0)),
        available_to: new Date(Date.UTC(1970, 0, 1, 18, 0, 0, 0)),
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
        available_from: new Date(Date.UTC(1970, 0, 1, 9, 0, 0, 0)),
        available_to: new Date(Date.UTC(1970, 0, 1, 18, 0, 0, 0)),
        available: true,
        user_id: 'pharmacist_backup',
        site_id: 'site_2',
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
          id: 'site_2',
          name: '支店',
          address: '東京都港区3-3-3',
          lat: 35.02,
          lng: 139.02,
        },
      },
    ]);
    businessHolidayFindManyMock.mockResolvedValueOnce([
      {
        date: new Date('2026-03-28T00:00:00.000Z'),
        site_id: 'site_1',
        is_closed: true,
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
    expect(result.drafts[0]).toMatchObject({
      proposed_pharmacist_id: 'pharmacist_backup',
      site_id: 'site_2',
    });
    expect(result.diagnostics.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pharmacist_id: 'pharmacist_primary',
          site_id: 'site_1',
          reason_code: 'business_holiday',
          detail: '拠点休業日のため候補外です',
        }),
      ]),
    );
    expect(result.diagnostics.rejected).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pharmacist_id: 'pharmacist_backup',
          reason_code: 'business_holiday',
        }),
      ]),
    );
  });

  it('places emergency proposals before lower-priority unlocked visits without crossing locked visits', async () => {
    pharmacistShiftFindManyMock.mockResolvedValueOnce([
      {
        date: new Date('2026-03-28T00:00:00.000Z'),
        available_from: new Date(Date.UTC(1970, 0, 1, 9, 0, 0, 0)),
        available_to: new Date(Date.UTC(1970, 0, 1, 18, 0, 0, 0)),
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
        priority: 'normal',
        scheduled_date: new Date('2026-03-28T00:00:00.000Z'),
        time_window_start: new Date(Date.UTC(1970, 0, 1, 9, 0, 0, 0)),
        time_window_end: new Date(Date.UTC(1970, 0, 1, 10, 0, 0, 0)),
        schedule_status: 'ready',
        confirmed_at: new Date('2026-03-27T03:00:00.000Z'),
        case_: {
          patient: {
            id: 'locked_patient',
            residences: [{ address: '東京都港区2-2-2', lat: 35.01, lng: 139.01 }],
          },
        },
        site: {
          address: '東京都港区2-2-2',
          lat: 35.01,
          lng: 139.01,
        },
      },
      {
        pharmacist_id: 'pharmacist_primary',
        route_order: 2,
        priority: 'normal',
        scheduled_date: new Date('2026-03-28T00:00:00.000Z'),
        time_window_start: new Date(Date.UTC(1970, 0, 1, 11, 0, 0, 0)),
        time_window_end: new Date(Date.UTC(1970, 0, 1, 12, 0, 0, 0)),
        schedule_status: 'planned',
        confirmed_at: null,
        case_: {
          patient: {
            id: 'normal_patient',
            residences: [{ address: '東京都港区1-1-2', lat: 35.0, lng: 139.0 }],
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
      visitType: 'emergency',
      priority: 'emergency',
      candidateCount: 1,
      startDate: new Date('2026-03-27T00:00:00.000Z'),
    });

    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]).toMatchObject({
      proposed_pharmacist_id: 'pharmacist_primary',
      priority: 'emergency',
      route_order: 2,
    });
    expect(result.drafts[0]?.proposal_reason).toContain('緊急訪問のため即応枠を優先');
    expect(result.diagnostics.accepted[0]).toMatchObject({
      route_order: 2,
      score_breakdown: expect.objectContaining({
        lockPenalty: 2,
      }),
    });
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
        available_from: new Date(Date.UTC(1970, 0, 1, 9, 0, 0, 0)),
        available_to: new Date(Date.UTC(1970, 0, 1, 18, 0, 0, 0)),
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
        available_from: new Date(Date.UTC(1970, 0, 1, 9, 0, 0, 0)),
        available_to: new Date(Date.UTC(1970, 0, 1, 18, 0, 0, 0)),
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
        time_window_start: new Date(Date.UTC(1970, 0, 1, 9, 0, 0, 0)),
        time_window_end: new Date(Date.UTC(1970, 0, 1, 10, 0, 0, 0)),
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

  it('assigns an available vehicle resource to accepted proposal drafts', async () => {
    const result = await generateVisitScheduleProposalDrafts({
      orgId: 'org_1',
      caseId: 'case_1',
      visitType: 'regular',
      priority: 'normal',
      candidateCount: 1,
      startDate: new Date('2026-03-27T00:00:00.000Z'),
    });

    expect(result.drafts[0]).toMatchObject({
      vehicle_resource_id: 'vehicle_1',
    });
    expect(result.drafts[0]?.proposal_reason).toContain('社用車A を割当');
    expect(result.diagnostics.accepted[0]).toMatchObject({
      vehicle_resource_id: 'vehicle_1',
      vehicle_resource_label: '社用車A',
      vehicle_load: 1,
      score_breakdown: expect.objectContaining({
        vehiclePenalty: 0,
      }),
    });
  });

  it('rejects candidates when the requested vehicle resource is at capacity', async () => {
    visitVehicleResourceFindManyMock.mockResolvedValueOnce([
      {
        id: 'vehicle_1',
        site_id: 'site_1',
        label: '社用車A',
        travel_mode: 'DRIVE',
        max_stops: 1,
      },
    ]);
    visitScheduleFindManyMock.mockResolvedValueOnce([
      {
        pharmacist_id: 'pharmacist_primary',
        vehicle_resource_id: 'vehicle_1',
        route_order: 1,
        scheduled_date: new Date('2026-03-28T00:00:00.000Z'),
        time_window_start: new Date(Date.UTC(1970, 0, 1, 9, 0, 0, 0)),
        time_window_end: new Date(Date.UTC(1970, 0, 1, 10, 0, 0, 0)),
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
      {
        pharmacist_id: 'pharmacist_backup',
        vehicle_resource_id: 'vehicle_1',
        route_order: 1,
        scheduled_date: new Date('2026-03-28T00:00:00.000Z'),
        time_window_start: new Date(Date.UTC(1970, 0, 1, 9, 0, 0, 0)),
        time_window_end: new Date(Date.UTC(1970, 0, 1, 10, 0, 0, 0)),
        schedule_status: 'planned',
        case_: {
          patient: {
            id: 'other_2',
            residences: [{ address: '東京都港区4-4-4', lat: 35.03, lng: 139.03 }],
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
      vehicleResourceId: 'vehicle_1',
    });

    expect(result.drafts).toHaveLength(0);
    expect(result.diagnostics.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason_code: 'vehicle_capacity',
          detail: '社用車A で訪問できる件数は最大 1 件です',
        }),
      ]),
    );
  });

  it('counts vehicle capacity across all pharmacists on the same day', async () => {
    pharmacistShiftFindManyMock.mockResolvedValueOnce([
      {
        date: new Date('2026-03-28T00:00:00.000Z'),
        available_from: new Date(Date.UTC(1970, 0, 1, 9, 0, 0, 0)),
        available_to: new Date(Date.UTC(1970, 0, 1, 18, 0, 0, 0)),
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
    visitVehicleResourceFindManyMock.mockResolvedValueOnce([
      {
        id: 'vehicle_1',
        site_id: 'site_1',
        label: '社用車A',
        travel_mode: 'DRIVE',
        max_stops: 1,
      },
    ]);
    visitScheduleFindManyMock.mockResolvedValueOnce([
      {
        pharmacist_id: 'pharmacist_backup',
        vehicle_resource_id: 'vehicle_1',
        route_order: 1,
        scheduled_date: new Date('2026-03-28T00:00:00.000Z'),
        time_window_start: new Date(Date.UTC(1970, 0, 1, 9, 0, 0, 0)),
        time_window_end: new Date(Date.UTC(1970, 0, 1, 10, 0, 0, 0)),
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
      vehicleResourceId: 'vehicle_1',
    });

    expect(result.drafts).toHaveLength(0);
    expect(result.diagnostics.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pharmacist_id: 'pharmacist_primary',
          reason_code: 'vehicle_capacity',
          detail: '社用車A で訪問できる件数は最大 1 件です',
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
        available_from: new Date(Date.UTC(1970, 0, 1, 9, 0, 0, 0)),
        available_to: new Date(Date.UTC(1970, 0, 1, 18, 0, 0, 0)),
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
        available_from: new Date(Date.UTC(1970, 0, 1, 9, 0, 0, 0)),
        available_to: new Date(Date.UTC(1970, 0, 1, 18, 0, 0, 0)),
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
        available_from: new Date(Date.UTC(1970, 0, 1, 9, 0, 0, 0)),
        available_to: new Date(Date.UTC(1970, 0, 1, 18, 0, 0, 0)),
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
          preferred_time_from: new Date(Date.UTC(1970, 0, 1, 9, 0, 0, 0)),
          preferred_time_to: new Date(Date.UTC(1970, 0, 1, 12, 0, 0, 0)),
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
        available_from: new Date(Date.UTC(1970, 0, 1, 9, 0, 0, 0)),
        available_to: new Date(Date.UTC(1970, 0, 1, 12, 0, 0, 0)),
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
        time_window_start: new Date(Date.UTC(1970, 0, 1, 9, 0, 0, 0)),
        time_window_end: new Date(Date.UTC(1970, 0, 1, 10, 0, 0, 0)),
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
          preferred_time_from: new Date(Date.UTC(1970, 0, 1, 9, 0, 0, 0)),
          preferred_time_to: new Date(Date.UTC(1970, 0, 1, 12, 0, 0, 0)),
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
        available_from: new Date(Date.UTC(1970, 0, 1, 9, 0, 0, 0)),
        available_to: new Date(Date.UTC(1970, 0, 1, 12, 0, 0, 0)),
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
        time_window_start: new Date(Date.UTC(1970, 0, 1, 9, 0, 0, 0)),
        time_window_end: new Date(Date.UTC(1970, 0, 1, 10, 0, 0, 0)),
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
