import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  withAuthMock,
  careCaseFindFirstMock,
  prescriptionIntakeFindFirstMock,
  visitScheduleFindManyMock,
  visitScheduleCountMock,
  userFindFirstMock,
  pharmacySiteInsuranceConfigFindFirstMock,
  findActiveVisitConsentMock,
  findCurrentManagementPlanMock,
} = vi.hoisted(() => ({
  withAuthMock: vi.fn(
    (
      handler: (req: NextRequest & { orgId: string; userId: string }) => Promise<Response>,
    ) => {
      return (req: NextRequest) =>
        handler({
          ...req,
          orgId: 'org_1',
          userId: 'user_1',
        } as NextRequest & { orgId: string; userId: string });
    },
  ),
  careCaseFindFirstMock: vi.fn(),
  prescriptionIntakeFindFirstMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  visitScheduleCountMock: vi.fn(),
  userFindFirstMock: vi.fn(),
  pharmacySiteInsuranceConfigFindFirstMock: vi.fn(),
  findActiveVisitConsentMock: vi.fn(),
  findCurrentManagementPlanMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: withAuthMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    careCase: {
      findFirst: careCaseFindFirstMock,
    },
    prescriptionIntake: {
      findFirst: prescriptionIntakeFindFirstMock,
    },
    visitSchedule: {
      findMany: visitScheduleFindManyMock,
      count: visitScheduleCountMock,
    },
    user: {
      findFirst: userFindFirstMock,
    },
    pharmacySiteInsuranceConfig: {
      findFirst: pharmacySiteInsuranceConfigFindFirstMock,
    },
    patientInsurance: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock('@/server/services/management-plans', () => ({
  findActiveVisitConsent: findActiveVisitConsentMock,
  findCurrentManagementPlan: findCurrentManagementPlanMock,
}));

import { GET } from './route';

describe('/api/visit-schedule-proposals/billing-preview GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    careCaseFindFirstMock.mockResolvedValue({
      id: 'case_1',
      patient_id: 'patient_1',
      primary_pharmacist_id: 'user_2',
      required_visit_support: null,
      patient: {
        medical_insurance_number: 'med_1',
        care_insurance_number: null,
      },
    });
    prescriptionIntakeFindFirstMock.mockResolvedValue({
      prescription_category: 'regular',
      emergency_category: null,
    });
    visitScheduleFindManyMock.mockResolvedValue([
      { scheduled_date: new Date('2026-04-02T00:00:00.000Z') },
      { scheduled_date: new Date('2026-04-09T00:00:00.000Z') },
    ]);
    visitScheduleCountMock.mockResolvedValue(2);
    userFindFirstMock.mockResolvedValue({ max_weekly_visits: 40 });
    pharmacySiteInsuranceConfigFindFirstMock.mockResolvedValue(null);
    findActiveVisitConsentMock.mockResolvedValue({ id: 'consent_1', expiry_date: new Date('2027-12-31') });
    findCurrentManagementPlanMock.mockResolvedValue({ current: { id: 'plan_1', status: 'approved' }, reviewOverdue: false });
  });

  it('returns cadence preview with scheduled dates and next billable date', async () => {
    const response = await GET({
      url: 'http://localhost/api/visit-schedule-proposals/billing-preview?case_id=case_1&proposed_date=2026-04-03',
    } as NextRequest);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      suggested_schedule_slot_count: 3,
      cadence: expect.objectContaining({
        current_month_count: 2,
        monthly_cap: 4,
        scheduled_dates_current_month: ['2026-04-02', '2026-04-09'],
        next_billable_date: '2026-04-03',
      }),
    });
  });
});
