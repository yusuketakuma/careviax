import { beforeEach, describe, expect, it, vi } from 'vitest';
import { format } from 'date-fns';

const {
  careCaseFindFirstMock,
  medicationCycleFindFirstMock,
  pharmacistShiftFindManyMock,
  pharmacyOperatingHoursFindManyMock,
  businessHolidayFindManyMock,
  visitScheduleFindManyMock,
  visitVehicleResourceFindManyMock,
  visitRecordFindFirstMock,
  evaluateVisitWorkflowGateMock,
} = vi.hoisted(() => ({
  careCaseFindFirstMock: vi.fn(),
  medicationCycleFindFirstMock: vi.fn(),
  pharmacistShiftFindManyMock: vi.fn(),
  pharmacyOperatingHoursFindManyMock: vi.fn(),
  businessHolidayFindManyMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  visitVehicleResourceFindManyMock: vi.fn(),
  visitRecordFindFirstMock: vi.fn(),
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
    pharmacyOperatingHours: {
      findMany: pharmacyOperatingHoursFindManyMock,
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
    visitRecord: {
      findFirst: visitRecordFindFirstMock,
    },
  },
}));

vi.mock('./management-plans', () => ({
  evaluateVisitWorkflowGate: evaluateVisitWorkflowGateMock,
}));

const { createRoadTravelEstimatorMock } = vi.hoisted(() => ({
  createRoadTravelEstimatorMock: vi.fn(),
}));

vi.mock('./road-routing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./road-routing')>();
  return {
    ...actual,
    createRoadTravelEstimator: createRoadTravelEstimatorMock,
  };
});

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
    visitRecordFindFirstMock.mockResolvedValue(null);
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
    pharmacyOperatingHoursFindManyMock.mockResolvedValue([]);
    businessHolidayFindManyMock.mockResolvedValue([]);
    visitScheduleFindManyMock.mockResolvedValue([]);
    visitVehicleResourceFindManyMock.mockResolvedValue([
      {
        id: 'vehicle_1',
        site_id: 'site_1',
        label: '社用車A',
        travel_mode: 'DRIVE',
        max_stops: 8,
        max_route_duration_minutes: null,
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
          OR: expect.arrayContaining([{ site_id: { in: ['site_1'] } }, { site_id: null }]),
        }),
      }),
    );
  });

  it('rejects candidates on a weekly regular-closed operating day', async () => {
    pharmacyOperatingHoursFindManyMock.mockResolvedValueOnce([
      {
        id: 'hours_sat_closed',
        site_id: 'site_1',
        weekday: 6,
        is_open: false,
        open_time: null,
        close_time: null,
        note: null,
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
          detail: '拠点定休日のため候補外です',
        }),
        expect.objectContaining({
          pharmacist_id: 'pharmacist_backup',
          site_id: 'site_1',
          reason_code: 'business_holiday',
          detail: '拠点定休日のため候補外です',
        }),
      ]),
    );
    expect(pharmacyOperatingHoursFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          site_id: { in: ['site_1'] },
        },
      }),
    );
  });

  it('allows weekly regular-closed operating days when an override reason is supplied', async () => {
    pharmacyOperatingHoursFindManyMock.mockResolvedValueOnce([
      {
        id: 'hours_sat_closed',
        site_id: 'site_1',
        weekday: 6,
        is_open: false,
        open_time: null,
        close_time: null,
        note: null,
      },
    ]);

    const result = await generateVisitScheduleProposalDrafts({
      orgId: 'org_1',
      caseId: 'case_1',
      visitType: 'regular',
      priority: 'normal',
      candidateCount: 1,
      startDate: new Date('2026-03-27T00:00:00.000Z'),
      operatingDayOverrideReason: '患者都合により定休日対応',
    });

    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]).toMatchObject({
      proposed_pharmacist_id: 'pharmacist_primary',
      site_id: 'site_1',
    });
    expect(result.diagnostics.rejected).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason_code: 'business_holiday',
        }),
      ]),
    );
  });

  it('rejects candidates when patient and facility visit windows conflict', async () => {
    careCaseFindFirstMock.mockResolvedValueOnce({
      id: 'case_1',
      patient_id: 'patient_1',
      primary_pharmacist_id: 'pharmacist_primary',
      backup_pharmacist_id: 'pharmacist_backup',
      patient: {
        scheduling_preference: {
          preferred_weekdays: [],
          preferred_time_from: new Date(Date.UTC(1970, 0, 1, 9, 0, 0, 0)),
          preferred_time_to: new Date(Date.UTC(1970, 0, 1, 10, 0, 0, 0)),
          facility_time_from: new Date(Date.UTC(1970, 0, 1, 13, 0, 0, 0)),
          facility_time_to: new Date(Date.UTC(1970, 0, 1, 14, 0, 0, 0)),
          family_presence_required: false,
          visit_buffer_minutes: null,
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
          reason_code: 'no_slot',
          detail: '患者在宅時間帯と施設受入時間帯が重ならないため候補外です',
        }),
        expect.objectContaining({
          pharmacist_id: 'pharmacist_backup',
          reason_code: 'no_slot',
          detail: '患者在宅時間帯と施設受入時間帯が重ならないため候補外です',
        }),
      ]),
    );
  });

  it('intersects weekly operating hours with patient visit windows before placing slots', async () => {
    careCaseFindFirstMock.mockResolvedValueOnce({
      id: 'case_1',
      patient_id: 'patient_1',
      primary_pharmacist_id: 'pharmacist_primary',
      backup_pharmacist_id: null,
      patient: {
        scheduling_preference: {
          preferred_weekdays: [],
          preferred_time_from: new Date(Date.UTC(1970, 0, 1, 11, 0, 0, 0)),
          preferred_time_to: new Date(Date.UTC(1970, 0, 1, 17, 0, 0, 0)),
          facility_time_from: null,
          facility_time_to: null,
          family_presence_required: false,
          visit_buffer_minutes: null,
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
    pharmacyOperatingHoursFindManyMock.mockResolvedValueOnce([
      {
        id: 'hours_sat_short',
        site_id: 'site_1',
        weekday: 6,
        is_open: true,
        open_time: new Date(Date.UTC(1970, 0, 1, 9, 0, 0, 0)),
        close_time: new Date(Date.UTC(1970, 0, 1, 13, 0, 0, 0)),
        note: null,
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
    expect(result.drafts[0]!.proposal_reason).toContain('訪問可能時間 11:00-13:00 内で配置');
    expect(result.drafts[0]!.proposal_reason).toContain('薬局営業時間を反映');
  });

  it('does not place proposal slots after weekly operating hours close', async () => {
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
    pharmacyOperatingHoursFindManyMock.mockResolvedValueOnce([
      {
        id: 'hours_sat_short',
        site_id: 'site_1',
        weekday: 6,
        is_open: true,
        open_time: new Date(Date.UTC(1970, 0, 1, 9, 0, 0, 0)),
        close_time: new Date(Date.UTC(1970, 0, 1, 13, 0, 0, 0)),
        note: null,
      },
    ]);
    visitScheduleFindManyMock.mockResolvedValueOnce([
      {
        pharmacist_id: 'pharmacist_primary',
        route_order: 1,
        scheduled_date: new Date('2026-03-28T00:00:00.000Z'),
        time_window_start: new Date(Date.UTC(1970, 0, 1, 9, 0, 0, 0)),
        time_window_end: new Date(Date.UTC(1970, 0, 1, 13, 0, 0, 0)),
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

    expect(result.drafts).toHaveLength(0);
    expect(result.diagnostics.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pharmacist_id: 'pharmacist_primary',
          reason_code: 'no_slot',
          detail: '希望時間帯内に 60 分の空き枠を確保できません',
        }),
      ]),
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

  it('compares fallback travel distance to max_travel_minutes after converting it to minutes', async () => {
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
          max_travel_minutes: 10,
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
      travelMode: 'WALK',
      startDate: new Date('2026-03-27T00:00:00.000Z'),
    });

    expect(result.drafts).toHaveLength(0);
    expect(result.diagnostics.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pharmacist_id: 'pharmacist_primary',
          travel_mode: 'WALK',
          reason_code: 'travel_limit',
          detail: expect.stringContaining('上限 10分'),
        }),
      ]),
    );
  });

  it('keeps road-estimated duration as the planner score even when distance is larger', async () => {
    createRoadTravelEstimatorMock.mockReturnValue(async () => ({
      durationMinutes: 8,
      distanceKm: 50,
    }));
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
          max_travel_minutes: 10,
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

    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]).toMatchObject({
      route_distance_score: 8,
    });
    expect(result.diagnostics.accepted[0]).toMatchObject({
      route_distance_score: 8,
      travel_summary: expect.stringContaining('実道路移動 約8分 / 50.0km'),
    });
  });

  it('rejects candidates whose adjacent insertion legs exceed max_travel_minutes even when route delta is small', async () => {
    const durationByAddressPair = new Map<string, number>([
      ['東京都港区2-2-2->既存A', 10],
      ['東京都港区2-2-2->東京都港区1-1-1', 200],
      ['東京都港区1-1-1->既存A', 200],
      ['既存A->東京都港区1-1-1', 40],
      ['東京都港区1-1-1->既存B', 40],
      ['既存A->既存B', 60],
      ['既存B->東京都港区1-1-1', 200],
    ]);
    createRoadTravelEstimatorMock.mockReturnValue(
      async (from: { address?: string | null }, to: { address?: string | null }) => ({
        durationMinutes: durationByAddressPair.get(`${from.address}->${to.address}`) ?? 200,
        distanceKm: 1,
      }),
    );
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
          max_travel_minutes: 30,
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
            id: 'existing_a',
            residences: [{ address: '既存A', lat: 35.02, lng: 139.02 }],
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
        scheduled_date: new Date('2026-03-28T00:00:00.000Z'),
        time_window_start: new Date(Date.UTC(1970, 0, 1, 11, 0, 0, 0)),
        time_window_end: new Date(Date.UTC(1970, 0, 1, 12, 0, 0, 0)),
        schedule_status: 'planned',
        confirmed_at: null,
        case_: {
          patient: {
            id: 'existing_b',
            residences: [{ address: '既存B', lat: 35.03, lng: 139.03 }],
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

    expect(result.drafts).toHaveLength(0);
    expect(result.diagnostics.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason_code: 'travel_limit',
          detail: expect.stringContaining('移動負荷 80.0分'),
        }),
      ]),
    );
  });

  it('rejects max_travel_minutes candidates when missing geocodes make the travel limit unverifiable', async () => {
    careCaseFindFirstMock.mockResolvedValueOnce({
      id: 'case_1',
      patient_id: 'patient_1',
      primary_pharmacist_id: 'pharmacist_primary',
      backup_pharmacist_id: null,
      patient: {
        scheduling_preference: null,
        residences: [
          {
            address: '東京都港区1-1-1',
            lat: null,
            lng: null,
            building_id: null,
          },
        ],
      },
    });
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
          max_travel_minutes: 10,
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

    expect(result.drafts).toHaveLength(0);
    expect(result.diagnostics.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason_code: 'travel_limit_unverified',
          reason_label: '移動上限未検証',
          detail: expect.stringContaining('住所座標を整備'),
        }),
      ]),
    );
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

  it('rejects vehicle route duration caps using the site-to-candidate-to-site round trip', async () => {
    const calls: string[] = [];
    createRoadTravelEstimatorMock.mockReturnValue(
      async (from: { address?: string | null }, to: { address?: string | null }) => {
        const key = `${from.address}->${to.address}`;
        calls.push(key);
        const durations = new Map<string, number>([
          ['東京都港区2-2-2->東京都港区1-1-1', 20],
          ['東京都港区1-1-1->東京都港区2-2-2', 20],
        ]);
        const durationMinutes = durations.get(key);
        return durationMinutes == null ? null : { durationMinutes, distanceKm: 1 };
      },
    );
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
        max_stops: 8,
        max_route_duration_minutes: 30,
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

    expect(result.drafts).toHaveLength(0);
    expect(calls).toEqual(
      expect.arrayContaining([
        '東京都港区2-2-2->東京都港区1-1-1',
        '東京都港区1-1-1->東京都港区2-2-2',
      ]),
    );
    expect(result.diagnostics.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason_code: 'vehicle_route_duration',
          reason_label: '車両稼働時間超過',
          detail: expect.stringContaining('社用車A'),
        }),
      ]),
    );
    expect(result.diagnostics.rejected[0]?.detail).toContain('推定稼働時間 40.0分');
    expect(result.diagnostics.rejected[0]?.detail).toContain('上限 30分');
  });

  it('rejects candidates when same-day assigned vehicle route total exceeds the vehicle cap', async () => {
    const calls: string[] = [];
    createRoadTravelEstimatorMock.mockReturnValue(
      async (from: { address?: string | null }, to: { address?: string | null }) => {
        const key = `${from.address}->${to.address}`;
        calls.push(key);
        const durations = new Map<string, number>([
          ['東京都港区2-2-2->既存A', 10],
          ['既存A->東京都港区1-1-1', 15],
          ['東京都港区1-1-1->既存B', 15],
          ['既存B->東京都港区2-2-2', 20],
          ['既存A->既存B', 20],
          ['東京都港区2-2-2->東京都港区1-1-1', 100],
          ['東京都港区1-1-1->東京都港区2-2-2', 100],
          ['東京都港区2-2-2->既存B', 100],
          ['既存A->東京都港区2-2-2', 100],
        ]);
        const durationMinutes = durations.get(key);
        return durationMinutes == null
          ? { durationMinutes: 100, distanceKm: 1 }
          : { durationMinutes, distanceKm: 1 };
      },
    );
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
        max_stops: 8,
        max_route_duration_minutes: 50,
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
        confirmed_at: null,
        case_: {
          patient: {
            id: 'existing_a',
            residences: [{ address: '既存A', lat: 35.02, lng: 139.02 }],
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
        route_order: 2,
        scheduled_date: new Date('2026-03-28T00:00:00.000Z'),
        time_window_start: new Date(Date.UTC(1970, 0, 1, 11, 0, 0, 0)),
        time_window_end: new Date(Date.UTC(1970, 0, 1, 12, 0, 0, 0)),
        schedule_status: 'planned',
        confirmed_at: null,
        case_: {
          patient: {
            id: 'existing_b',
            residences: [{ address: '既存B', lat: 35.03, lng: 139.03 }],
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

    expect(result.drafts).toHaveLength(0);
    expect(calls).toContain('既存B->東京都港区2-2-2');
    expect(result.diagnostics.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason_code: 'vehicle_route_duration',
          detail: expect.stringContaining('推定稼働時間 60.0分'),
        }),
      ]),
    );
    expect(result.diagnostics.rejected[0]?.detail).toContain('上限 50分');
  });

  it('fails closed when a configured vehicle route duration cap cannot be verified', async () => {
    createRoadTravelEstimatorMock.mockReturnValue(async () => null);
    careCaseFindFirstMock.mockResolvedValueOnce({
      id: 'case_1',
      patient_id: 'patient_1',
      primary_pharmacist_id: 'pharmacist_primary',
      backup_pharmacist_id: null,
      patient: {
        scheduling_preference: null,
        residences: [
          {
            address: '東京都港区1-1-1',
            lat: null,
            lng: null,
            building_id: null,
          },
        ],
      },
    });
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
        max_stops: 8,
        max_route_duration_minutes: 30,
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

    expect(result.drafts).toHaveLength(0);
    expect(result.diagnostics.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason_code: 'vehicle_route_duration',
          detail: expect.stringContaining('社用車A の稼働上限 30分を検証できません'),
        }),
      ]),
    );
  });

  it('rejects a requested vehicle resource whose travel mode does not match the proposal mode', async () => {
    visitVehicleResourceFindManyMock.mockResolvedValueOnce([
      {
        id: 'vehicle_1',
        site_id: 'site_1',
        label: '電動自転車A',
        travel_mode: 'BICYCLE',
        max_stops: 8,
        max_route_duration_minutes: null,
      },
    ]);

    const result = await generateVisitScheduleProposalDrafts({
      orgId: 'org_1',
      caseId: 'case_1',
      visitType: 'regular',
      priority: 'normal',
      candidateCount: 1,
      travelMode: 'DRIVE',
      startDate: new Date('2026-03-27T00:00:00.000Z'),
      vehicleResourceId: 'vehicle_1',
    });

    expect(result.drafts).toHaveLength(0);
    expect(result.diagnostics.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason_code: 'vehicle_travel_mode_mismatch',
          reason_label: '車両移動手段不一致',
          detail: expect.stringContaining('電動自転車A'),
        }),
      ]),
    );
  });

  it('excludes the reschedule source schedule before checking vehicle route duration caps', async () => {
    createRoadTravelEstimatorMock.mockReturnValue(
      async (from: { address?: string | null }, to: { address?: string | null }) => {
        const durations = new Map<string, number>([
          ['東京都港区2-2-2->東京都港区1-1-1', 10],
          ['東京都港区1-1-1->東京都港区2-2-2', 10],
        ]);
        const durationMinutes = durations.get(`${from.address}->${to.address}`);
        return durationMinutes == null
          ? { durationMinutes: 100, distanceKm: 1 }
          : { durationMinutes, distanceKm: 1 };
      },
    );
    visitVehicleResourceFindManyMock.mockResolvedValueOnce([
      {
        id: 'vehicle_1',
        site_id: 'site_1',
        label: '社用車A',
        travel_mode: 'DRIVE',
        max_stops: 8,
        max_route_duration_minutes: 30,
      },
    ]);
    visitScheduleFindManyMock.mockImplementationOnce(async (args: { where?: { id?: unknown } }) => {
      if (JSON.stringify(args.where?.id) === JSON.stringify({ not: 'schedule_source' })) {
        return [];
      }
      return [
        {
          id: 'schedule_source',
          pharmacist_id: 'pharmacist_primary',
          vehicle_resource_id: 'vehicle_1',
          route_order: 1,
          scheduled_date: new Date('2026-03-28T00:00:00.000Z'),
          time_window_start: new Date(Date.UTC(1970, 0, 1, 9, 0, 0, 0)),
          time_window_end: new Date(Date.UTC(1970, 0, 1, 10, 0, 0, 0)),
          schedule_status: 'planned',
          confirmed_at: null,
          case_: {
            patient: {
              id: 'patient_1',
              residences: [{ address: '既存A', lat: 35.02, lng: 139.02 }],
            },
          },
          site: {
            address: '東京都港区2-2-2',
            lat: 35.01,
            lng: 139.01,
          },
        },
      ];
    });

    const result = await generateVisitScheduleProposalDrafts({
      orgId: 'org_1',
      caseId: 'case_1',
      visitType: 'regular',
      priority: 'normal',
      candidateCount: 1,
      startDate: new Date('2026-03-27T00:00:00.000Z'),
      rescheduleSourceScheduleId: 'schedule_source',
    });

    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]).toMatchObject({
      proposal_status: 'reschedule_pending',
      reschedule_source_schedule_id: 'schedule_source',
      vehicle_resource_id: 'vehicle_1',
    });
    expect(visitScheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { not: 'schedule_source' },
        }),
      }),
    );
  });

  it('rejects candidates when the requested vehicle resource is at capacity', async () => {
    visitVehicleResourceFindManyMock.mockResolvedValueOnce([
      {
        id: 'vehicle_1',
        site_id: 'site_1',
        label: '社用車A',
        travel_mode: 'DRIVE',
        max_stops: 1,
        max_route_duration_minutes: null,
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
        max_route_duration_minutes: null,
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

  it('uses the earliest continuing non-PRN medication end date as an inclusive deadline', async () => {
    medicationCycleFindFirstMock.mockResolvedValueOnce({
      id: 'cycle_1',
      prescription_intakes: [
        {
          refill_next_dispense_date: null,
          split_next_dispense_date: null,
          lines: [
            {
              drug_name: '疼痛時薬',
              frequency: '疼痛時',
              end_date: new Date('2026-03-24T00:00:00.000Z'),
            },
            {
              drug_name: '継続薬A',
              frequency: '朝食後',
              end_date: new Date('2026-03-30T00:00:00.000Z'),
            },
            {
              drug_name: '継続薬B',
              frequency: '夕食後',
              start_date: new Date('2026-03-20T00:00:00.000Z'),
              days: 20,
              end_date: null,
            },
          ],
        },
      ],
    });
    pharmacistShiftFindManyMock.mockResolvedValueOnce([
      {
        date: new Date('2026-03-30T00:00:00.000Z'),
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
        date: new Date('2026-03-31T00:00:00.000Z'),
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
      visit_deadline_date: new Date('2026-03-30T00:00:00.000Z'),
      proposed_date: new Date('2026-03-30T00:00:00.000Z'),
    });
    const cycleQuery = medicationCycleFindFirstMock.mock.calls[0]?.[0];
    expect(cycleQuery?.where?.overall_status?.notIn).toEqual(
      expect.arrayContaining(['cancelled', 'reported', 'on_hold', 'visit_completed']),
    );
    expect(cycleQuery?.include?.prescription_intakes?.include?.lines?.select).toEqual(
      expect.objectContaining({
        frequency: true,
        route: true,
        notes: true,
      }),
    );
    expect(result.diagnostics.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pharmacist_id: 'pharmacist_backup',
          reason_code: 'beyond_deadline',
          detail: '訪問期限 2026-03-30 を超えるため候補外です',
        }),
      ]),
    );
  });

  it('derives medication end dates from start_date and days when stored end_date is missing', async () => {
    medicationCycleFindFirstMock.mockResolvedValueOnce({
      id: 'cycle_1',
      prescription_intakes: [
        {
          refill_next_dispense_date: null,
          split_next_dispense_date: null,
          lines: [
            {
              end_date: null,
              start_date: new Date('2026-03-20T00:00:00.000Z'),
              days: 10,
            },
          ],
        },
      ],
    });

    const result = await generateVisitScheduleProposalDrafts({
      orgId: 'org_1',
      caseId: 'case_1',
      visitType: 'regular',
      priority: 'normal',
      candidateCount: 1,
      startDate: new Date('2026-03-27T00:00:00.000Z'),
    });

    expect(result.drafts[0]).toMatchObject({
      medication_end_date: new Date('2026-03-29T00:00:00.000Z'),
      visit_deadline_date: new Date('2026-03-29T00:00:00.000Z'),
      proposed_date: new Date('2026-03-28T00:00:00.000Z'),
    });
  });

  it('uses split dispensing next dispense dates when deriving the visit deadline', async () => {
    medicationCycleFindFirstMock.mockResolvedValueOnce({
      id: 'cycle_1',
      prescription_intakes: [
        {
          refill_next_dispense_date: null,
          split_next_dispense_date: new Date('2026-03-30T00:00:00.000Z'),
          lines: [{ end_date: null, start_date: null, days: 14 }],
        },
      ],
    });
    pharmacistShiftFindManyMock.mockResolvedValueOnce([
      {
        date: new Date('2026-03-30T00:00:00.000Z'),
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
        date: new Date('2026-03-31T00:00:00.000Z'),
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
      medication_end_date: null,
      visit_deadline_date: new Date('2026-03-30T00:00:00.000Z'),
      proposed_date: new Date('2026-03-30T00:00:00.000Z'),
    });
    expect(result.diagnostics.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pharmacist_id: 'pharmacist_backup',
          reason_code: 'beyond_deadline',
          detail: '訪問期限 2026-03-30 を超えるため候補外です',
        }),
      ]),
    );
  });

  it('caps the visit deadline by earlier split dispensing dates even when line supply lasts longer', async () => {
    medicationCycleFindFirstMock.mockResolvedValueOnce({
      id: 'cycle_1',
      prescription_intakes: [
        {
          refill_next_dispense_date: null,
          split_next_dispense_date: new Date('2026-03-30T00:00:00.000Z'),
          lines: [
            {
              end_date: null,
              start_date: new Date('2026-03-20T00:00:00.000Z'),
              days: 20,
            },
          ],
        },
      ],
    });

    const result = await generateVisitScheduleProposalDrafts({
      orgId: 'org_1',
      caseId: 'case_1',
      visitType: 'regular',
      priority: 'normal',
      candidateCount: 1,
      startDate: new Date('2026-03-27T00:00:00.000Z'),
    });

    expect(result.drafts[0]).toMatchObject({
      medication_end_date: new Date('2026-04-08T00:00:00.000Z'),
      visit_deadline_date: new Date('2026-03-30T00:00:00.000Z'),
      proposed_date: new Date('2026-03-28T00:00:00.000Z'),
    });
  });

  it('uses the latest visit-record suggestion as a deadline candidate', async () => {
    medicationCycleFindFirstMock.mockResolvedValueOnce({
      id: 'cycle_1',
      prescription_intakes: [
        {
          refill_next_dispense_date: null,
          split_next_dispense_date: null,
          lines: [
            {
              drug_name: '継続薬',
              frequency: '朝食後',
              start_date: new Date('2026-03-20T00:00:00.000Z'),
              days: 20,
              end_date: null,
            },
          ],
        },
      ],
    });
    visitRecordFindFirstMock.mockResolvedValueOnce({
      next_visit_suggestion_date: new Date('2026-03-31T00:00:00.000Z'),
    });
    pharmacistShiftFindManyMock.mockResolvedValueOnce([
      {
        date: new Date('2026-03-31T00:00:00.000Z'),
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
        date: new Date('2026-04-01T00:00:00.000Z'),
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

    expect(visitRecordFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          schedule: expect.objectContaining({
            org_id: 'org_1',
            case_id: 'case_1',
          }),
        }),
        orderBy: [{ visit_date: 'desc' }, { created_at: 'desc' }, { id: 'desc' }],
      }),
    );
    expect(result.drafts[0]).toMatchObject({
      medication_end_date: new Date('2026-04-08T00:00:00.000Z'),
      visit_deadline_date: new Date('2026-03-31T00:00:00.000Z'),
      proposed_date: new Date('2026-03-31T00:00:00.000Z'),
    });
    expect(result.diagnostics.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pharmacist_id: 'pharmacist_backup',
          reason_code: 'beyond_deadline',
        }),
      ]),
    );
  });

  it('does not reuse an older visit-record suggestion when the latest visit has none', async () => {
    medicationCycleFindFirstMock.mockResolvedValueOnce({
      id: 'cycle_1',
      prescription_intakes: [
        {
          refill_next_dispense_date: null,
          split_next_dispense_date: null,
          lines: [
            {
              drug_name: '継続薬',
              frequency: '朝食後',
              start_date: new Date('2026-03-20T00:00:00.000Z'),
              days: 20,
              end_date: null,
            },
          ],
        },
      ],
    });
    visitRecordFindFirstMock.mockResolvedValueOnce({
      next_visit_suggestion_date: null,
    });
    pharmacistShiftFindManyMock.mockResolvedValueOnce([
      {
        date: new Date('2026-04-01T00:00:00.000Z'),
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

    const result = await generateVisitScheduleProposalDrafts({
      orgId: 'org_1',
      caseId: 'case_1',
      visitType: 'regular',
      priority: 'normal',
      candidateCount: 1,
      startDate: new Date('2026-03-27T00:00:00.000Z'),
    });

    expect(visitRecordFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({
          next_visit_suggestion_date: expect.anything(),
        }),
      }),
    );
    expect(result.drafts[0]).toMatchObject({
      medication_end_date: new Date('2026-04-08T00:00:00.000Z'),
      visit_deadline_date: new Date('2026-04-08T00:00:00.000Z'),
      proposed_date: new Date('2026-04-01T00:00:00.000Z'),
    });
    expect(result.diagnostics.rejected).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason_code: 'beyond_deadline',
        }),
      ]),
    );
  });

  it('keeps overdue medication deadlines urgent and returns an ASAP candidate', async () => {
    medicationCycleFindFirstMock.mockResolvedValueOnce({
      id: 'cycle_1',
      prescription_intakes: [
        {
          refill_next_dispense_date: null,
          split_next_dispense_date: null,
          lines: [
            {
              drug_name: '継続薬',
              frequency: '朝食後',
              end_date: new Date('2026-03-25T00:00:00.000Z'),
            },
          ],
        },
      ],
    });
    pharmacistShiftFindManyMock.mockResolvedValueOnce([
      {
        date: new Date('2026-03-27T00:00:00.000Z'),
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
      priority: 'urgent',
      medication_end_date: new Date('2026-03-25T00:00:00.000Z'),
      visit_deadline_date: new Date('2026-03-25T00:00:00.000Z'),
      proposed_date: new Date('2026-03-27T00:00:00.000Z'),
    });
    expect(result.drafts[0]?.proposal_reason).toContain('訪問期限 2026-03-25 超過');
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
