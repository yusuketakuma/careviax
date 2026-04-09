import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('./road-routing', () => ({
  createRoadTravelEstimator: () => async () => null,
}));

import { generateVisitScheduleProposalDrafts } from './visit-schedule-planner';

describe('generateVisitScheduleProposalDrafts', () => {
  beforeEach(() => {
    vi.clearAllMocks();

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
      ])
    );
  });
});
