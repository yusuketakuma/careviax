import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withAuthContextMock,
  withOrgContextMock,
  careCaseFindFirstMock,
  membershipFindFirstMock,
  pharmacySiteFindFirstMock,
  buildVisitScheduleBillingPreviewMock,
} = vi.hoisted(() => ({
  withAuthContextMock: vi.fn(
    (
      handler: (
        req: NextRequest,
        ctx: { orgId: string; userId: string; role: 'pharmacist' },
        routeContext: { params: Promise<Record<string, string>> },
      ) => Promise<Response>,
      _options?: unknown,
    ) => {
      void _options;
      return (req: NextRequest, routeContext: { params: Promise<Record<string, string>> }) =>
        handler(
          req,
          {
            orgId: 'org_1',
            userId: 'user_1',
            role: 'pharmacist',
          },
          routeContext,
        );
    },
  ),
  withOrgContextMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  pharmacySiteFindFirstMock: vi.fn(),
  buildVisitScheduleBillingPreviewMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: withAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    pharmacySite: {
      findFirst: pharmacySiteFindFirstMock,
    },
    careCase: {
      findFirst: careCaseFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/visit-schedule-billing-preview', () => ({
  buildVisitScheduleBillingPreview: buildVisitScheduleBillingPreviewMock,
}));

import { GET } from './route';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const emptyRouteContext = { params: Promise.resolve({}) };
const withAuthRegistrationCalls = [...withAuthContextMock.mock.calls];

describe('/api/visit-schedule-proposals/billing-preview GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    careCaseFindFirstMock.mockResolvedValue({
      id: 'case_1',
    });
    membershipFindFirstMock.mockResolvedValue({ user_id: 'pharm_1' });
    pharmacySiteFindFirstMock.mockResolvedValue({ id: 'site_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        careCase: {
          findFirst: careCaseFindFirstMock,
        },
      }),
    );
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
    const response = await GET(
      new NextRequest(
        'http://localhost/api/visit-schedule-proposals/billing-preview?case_id=case_1&proposed_date=2026-04-03',
      ),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    // 組織横断アクセスロール(pharmacist)は担当割当スコープが撤廃され、
    // ケースアクセスは org_id ベースの組織内検索のみ(AND 担当割当句なし)。
    expect(careCaseFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'case_1',
        org_id: 'org_1',
      },
      select: { id: true },
    });
    expect(careCaseFindFirstMock.mock.invocationCallOrder[0]).toBeLessThan(
      buildVisitScheduleBillingPreviewMock.mock.invocationCallOrder[0],
    );
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      }),
    });
    expect(buildVisitScheduleBillingPreviewMock).toHaveBeenCalledWith(
      {
        orgId: 'org_1',
        caseId: 'case_1',
        proposedDate: '2026-04-03',
        pharmacistId: null,
        siteId: null,
        visitType: null,
        excludeScheduleId: null,
        excludeProposalId: null,
      },
      {
        db: expect.objectContaining({
          careCase: expect.objectContaining({
            findFirst: careCaseFindFirstMock,
          }),
        }),
      },
    );
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

  it('passes exclude ids through to avoid counting the row under edit', async () => {
    const response = await GET(
      new NextRequest(
        'http://localhost/api/visit-schedule-proposals/billing-preview?case_id=case_1&proposed_date=2026-04-03&exclude_schedule_id=schedule_1&exclude_proposal_id=proposal_1',
      ),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(buildVisitScheduleBillingPreviewMock).toHaveBeenCalledWith(
      expect.objectContaining({
        excludeScheduleId: 'schedule_1',
        excludeProposalId: 'proposal_1',
      }),
      expect.objectContaining({ db: expect.any(Object) }),
    );
  });

  it('rejects pharmacist references outside the org before opening the preview transaction', async () => {
    membershipFindFirstMock.mockResolvedValueOnce(null);

    const response = await GET(
      new NextRequest(
        'http://localhost/api/visit-schedule-proposals/billing-preview?case_id=case_1&proposed_date=2026-04-03&pharmacist_id=pharm_other',
      ),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '指定された薬剤師はこの組織に所属していません',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(buildVisitScheduleBillingPreviewMock).not.toHaveBeenCalled();
  });

  it('rejects site references outside the org before opening the preview transaction', async () => {
    pharmacySiteFindFirstMock.mockResolvedValueOnce(null);

    const response = await GET(
      new NextRequest(
        'http://localhost/api/visit-schedule-proposals/billing-preview?case_id=case_1&proposed_date=2026-04-03&site_id=site_other',
      ),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '指定された店舗が見つかりません',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(buildVisitScheduleBillingPreviewMock).not.toHaveBeenCalled();
  });

  it('denies unassigned preview requests before calling the billing-preview service', async () => {
    careCaseFindFirstMock.mockResolvedValueOnce(null);

    const response = await GET(
      new NextRequest(
        'http://localhost/api/visit-schedule-proposals/billing-preview?case_id=case_unassigned&proposed_date=2026-04-03',
      ),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(buildVisitScheduleBillingPreviewMock).not.toHaveBeenCalled();
  });

  it('rejects invalid proposed_date values before case lookup', async () => {
    const response = await GET(
      new NextRequest(
        'http://localhost/api/visit-schedule-proposals/billing-preview?case_id=case_1&proposed_date=2026-02-30',
      ),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
      details: {
        proposed_date: ['日付形式が不正です（YYYY-MM-DD）'],
      },
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(buildVisitScheduleBillingPreviewMock).not.toHaveBeenCalled();
  });

  it('returns a no-store fixed error without leaking raw lookup failures', async () => {
    careCaseFindFirstMock.mockRejectedValueOnce(
      new Error('raw patient billing preview lookup failure'),
    );

    const response = await GET(
      new NextRequest(
        'http://localhost/api/visit-schedule-proposals/billing-preview?case_id=case_1&proposed_date=2026-04-03',
      ),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.text();
    expect(body).toContain('INTERNAL_ERROR');
    expect(body).not.toContain('raw patient billing preview lookup failure');
    expect(buildVisitScheduleBillingPreviewMock).not.toHaveBeenCalled();
  });
});
