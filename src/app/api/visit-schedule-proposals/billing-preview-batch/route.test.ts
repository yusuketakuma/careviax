import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  withAuthMock,
  careCaseFindFirstMock,
  prescriptionIntakeFindFirstMock,
  visitScheduleFindManyMock,
  visitScheduleCountMock,
  userFindFirstMock,
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
  },
}));

vi.mock('@/server/services/management-plans', () => ({
  findActiveVisitConsent: findActiveVisitConsentMock,
  findCurrentManagementPlan: findCurrentManagementPlanMock,
}));

import { POST } from './route';

describe('/api/visit-schedule-proposals/billing-preview-batch POST', () => {
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
    ]);
    visitScheduleCountMock.mockResolvedValue(1);
    userFindFirstMock.mockResolvedValue({ max_weekly_visits: 40 });
    findActiveVisitConsentMock.mockResolvedValue({ id: 'consent_1', expiry_date: new Date('2027-12-31') });
    findCurrentManagementPlanMock.mockResolvedValue({ current: { id: 'plan_1', status: 'approved' }, reviewOverdue: false });
  });

  it('returns keyed preview results for multiple requests', async () => {
    const response = await POST({
      json: async () => ({
        items: [
          { key: 'proposal_1', case_id: 'case_1', proposed_date: '2026-04-03' },
          { key: 'schedule_1', case_id: 'case_1', proposed_date: '2026-04-05', visit_type: 'regular' },
        ],
      }),
    } as NextRequest);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        proposal_1: expect.objectContaining({
          cadence: expect.objectContaining({
            next_billable_date: '2026-04-03',
          }),
        }),
        schedule_1: expect.objectContaining({
          cadence: expect.objectContaining({
            current_month_count: 1,
          }),
        }),
      },
    });
  });
});
