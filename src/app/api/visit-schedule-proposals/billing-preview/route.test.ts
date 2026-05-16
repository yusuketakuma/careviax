import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { withAuthMock, careCaseFindFirstMock, buildVisitScheduleBillingPreviewMock } = vi.hoisted(
  () => ({
    withAuthMock: vi.fn(
      (
        handler: (
          req: NextRequest & { orgId: string; userId: string; role: 'pharmacist' },
        ) => Promise<Response>,
        _options?: unknown,
      ) => {
        void _options;
        return (req: NextRequest) =>
          handler({
            ...req,
            orgId: 'org_1',
            userId: 'user_1',
            role: 'pharmacist',
          } as NextRequest & { orgId: string; userId: string; role: 'pharmacist' });
      },
    ),
    careCaseFindFirstMock: vi.fn(),
    buildVisitScheduleBillingPreviewMock: vi.fn(),
  }),
);

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: withAuthMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    careCase: {
      findFirst: careCaseFindFirstMock,
    },
  },
}));

vi.mock('@/server/services/visit-schedule-billing-preview', () => ({
  buildVisitScheduleBillingPreview: buildVisitScheduleBillingPreviewMock,
}));

import { GET } from './route';

const withAuthRegistrationCalls = [...withAuthMock.mock.calls];

describe('/api/visit-schedule-proposals/billing-preview GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    careCaseFindFirstMock.mockResolvedValue({
      id: 'case_1',
    });
    buildVisitScheduleBillingPreviewMock.mockResolvedValue({
      suggested_schedule_slot_count: 3,
      cadence: {
        current_month_count: 2,
        monthly_cap: 4,
        scheduled_dates_current_month: ['2026-04-02', '2026-04-09'],
        next_billable_date: '2026-04-03',
      },
    });
  });

  it('registers the route with canVisit permission', () => {
    expect(withAuthRegistrationCalls[0]?.[1]).toMatchObject({
      permission: 'canVisit',
      message: '訪問候補の算定プレビュー権限がありません',
    });
  });

  it('returns cadence preview with scheduled dates and next billable date', async () => {
    const response = await GET({
      url: 'http://localhost/api/visit-schedule-proposals/billing-preview?case_id=case_1&proposed_date=2026-04-03',
    } as NextRequest);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(careCaseFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'case_1',
        org_id: 'org_1',
        AND: [
          {
            OR: [
              { primary_pharmacist_id: 'user_1' },
              { backup_pharmacist_id: 'user_1' },
              { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
            ],
          },
        ],
      },
      select: { id: true },
    });
    expect(careCaseFindFirstMock.mock.invocationCallOrder[0]).toBeLessThan(
      buildVisitScheduleBillingPreviewMock.mock.invocationCallOrder[0],
    );
    expect(buildVisitScheduleBillingPreviewMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      caseId: 'case_1',
      proposedDate: '2026-04-03',
      pharmacistId: null,
      siteId: null,
      visitType: null,
    });
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

  it('denies unassigned preview requests before calling the billing-preview service', async () => {
    careCaseFindFirstMock.mockResolvedValueOnce(null);

    const response = await GET({
      url: 'http://localhost/api/visit-schedule-proposals/billing-preview?case_id=case_unassigned&proposed_date=2026-04-03',
    } as NextRequest);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(buildVisitScheduleBillingPreviewMock).not.toHaveBeenCalled();
  });
});
