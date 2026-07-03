import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withAuthContextMock,
  withOrgContextMock,
  careCaseFindFirstMock,
  careCaseFindManyMock,
  membershipFindManyMock,
  pharmacySiteFindFirstMock,
  buildVisitScheduleBillingPreviewBatchMock,
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
  careCaseFindManyMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  pharmacySiteFindFirstMock: vi.fn(),
  buildVisitScheduleBillingPreviewBatchMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: withAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findMany: membershipFindManyMock,
    },
    pharmacySite: {
      findFirst: pharmacySiteFindFirstMock,
    },
    careCase: {
      findFirst: careCaseFindFirstMock,
      findMany: careCaseFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/visit-schedule-billing-preview', () => ({
  buildVisitScheduleBillingPreviewBatch: buildVisitScheduleBillingPreviewBatchMock,
}));

import { POST } from './route';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const emptyRouteContext = { params: Promise.resolve({}) };
const withAuthRegistrationCalls = [...withAuthContextMock.mock.calls];

function createPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/visit-schedule-proposals/billing-preview-batch', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function createMalformedJsonPostRequest() {
  return new NextRequest('http://localhost/api/visit-schedule-proposals/billing-preview-batch', {
    method: 'POST',
    body: '{"items":',
    headers: { 'content-type': 'application/json' },
  });
}

describe('/api/visit-schedule-proposals/billing-preview-batch POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    careCaseFindFirstMock.mockResolvedValue({
      id: 'case_1',
    });
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1' }]);
    membershipFindManyMock.mockResolvedValue([{ user_id: 'pharm_1' }]);
    pharmacySiteFindFirstMock.mockResolvedValue({ id: 'site_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        careCase: {
          findFirst: careCaseFindFirstMock,
          findMany: careCaseFindManyMock,
        },
      }),
    );
    buildVisitScheduleBillingPreviewBatchMock.mockResolvedValue({
      proposal_1: {
        cadence: {
          next_billable_date: '2026-04-03',
        },
      },
      schedule_1: {
        cadence: {
          current_month_count: 1,
        },
      },
    });
  });

  it('registers the route with canVisit permission', () => {
    expect(withAuthRegistrationCalls[0]?.[1]).toMatchObject({
      permission: 'canVisit',
      message: '訪問候補の算定プレビュー権限がありません',
    });
  });

  it('returns keyed preview results for multiple requests', async () => {
    const response = await POST(
      createPostRequest({
        items: [
          { key: 'proposal_1', case_id: 'case_1', proposed_date: '2026-04-03' },
          {
            key: 'schedule_1',
            case_id: 'case_1',
            proposed_date: '2026-04-05',
            visit_type: 'regular',
          },
        ],
      }),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    // 組織横断アクセスロール(pharmacist)は担当割当スコープが撤廃されるため、
    // ケースアクセスは batch 全体で org_id + id IN の 1 query に集約される。
    expect(careCaseFindManyMock).toHaveBeenCalledTimes(1);
    expect(careCaseFindManyMock).toHaveBeenCalledWith({
      where: {
        id: { in: ['case_1'] },
        org_id: 'org_1',
      },
      select: { id: true },
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(buildVisitScheduleBillingPreviewBatchMock).toHaveBeenCalledWith(
      [
        {
          key: 'proposal_1',
          caseId: 'case_1',
          proposedDate: '2026-04-03',
          pharmacistId: undefined,
          siteId: undefined,
          visitType: undefined,
          excludeScheduleId: undefined,
          excludeProposalId: undefined,
        },
        {
          key: 'schedule_1',
          caseId: 'case_1',
          proposedDate: '2026-04-05',
          pharmacistId: undefined,
          siteId: undefined,
          visitType: 'regular',
          excludeScheduleId: undefined,
          excludeProposalId: undefined,
        },
      ],
      'org_1',
      {
        db: expect.objectContaining({
          careCase: expect.objectContaining({
            findMany: careCaseFindManyMock,
          }),
        }),
      },
    );
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      }),
    });
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

  it('passes exclude ids through for batch edit previews', async () => {
    const response = await POST(
      createPostRequest({
        items: [
          {
            key: 'proposal_1',
            case_id: 'case_1',
            proposed_date: '2026-04-03',
            exclude_schedule_id: 'schedule_1',
            exclude_proposal_id: 'proposal_1',
          },
        ],
      }),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(buildVisitScheduleBillingPreviewBatchMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          key: 'proposal_1',
          excludeScheduleId: 'schedule_1',
          excludeProposalId: 'proposal_1',
        }),
      ],
      'org_1',
      expect.objectContaining({ db: expect.any(Object) }),
    );
  });

  it('rejects pharmacist references outside the org before opening the batch preview transaction', async () => {
    membershipFindManyMock.mockResolvedValueOnce([]);

    const response = await POST(
      createPostRequest({
        items: [
          {
            key: 'proposal_1',
            case_id: 'case_1',
            proposed_date: '2026-04-03',
            pharmacist_id: 'pharm_other',
          },
        ],
      }),
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
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(buildVisitScheduleBillingPreviewBatchMock).not.toHaveBeenCalled();
  });

  it('rejects site references outside the org before opening the batch preview transaction', async () => {
    pharmacySiteFindFirstMock.mockResolvedValueOnce(null);

    const response = await POST(
      createPostRequest({
        items: [
          {
            key: 'proposal_1',
            case_id: 'case_1',
            proposed_date: '2026-04-03',
            site_id: 'site_other',
          },
        ],
      }),
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
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(buildVisitScheduleBillingPreviewBatchMock).not.toHaveBeenCalled();
  });

  it('rejects non-object batch preview payloads before case lookup', async () => {
    const response = await POST(createPostRequest([]), emptyRouteContext);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(buildVisitScheduleBillingPreviewBatchMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON batch preview payloads before case lookup', async () => {
    const response = await POST(createMalformedJsonPostRequest(), emptyRouteContext);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(buildVisitScheduleBillingPreviewBatchMock).not.toHaveBeenCalled();
  });

  it('rejects invalid proposed_date values before case lookup', async () => {
    const response = await POST(
      createPostRequest({
        items: [{ key: 'proposal_1', case_id: 'case_1', proposed_date: '2026-02-30' }],
      }),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(buildVisitScheduleBillingPreviewBatchMock).not.toHaveBeenCalled();
  });

  it('denies unassigned batch preview requests before calling the billing-preview service', async () => {
    careCaseFindManyMock.mockResolvedValueOnce([]);

    const response = await POST(
      createPostRequest({
        items: [{ key: 'proposal_1', case_id: 'case_unassigned', proposed_date: '2026-04-03' }],
      }),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(buildVisitScheduleBillingPreviewBatchMock).not.toHaveBeenCalled();
  });

  it('returns a no-store fixed error without leaking raw service failures', async () => {
    buildVisitScheduleBillingPreviewBatchMock.mockRejectedValueOnce(
      new Error('PHI leak candidate: patient 山田太郎 billing preview failed'),
    );

    const response = await POST(
      createPostRequest({
        items: [{ key: 'proposal_1', case_id: 'case_1', proposed_date: '2026-04-03' }],
      }),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.text();
    expect(body).toContain('INTERNAL_ERROR');
    expect(body).not.toContain('PHI leak candidate');
    expect(body).not.toContain('山田太郎');
  });
});
