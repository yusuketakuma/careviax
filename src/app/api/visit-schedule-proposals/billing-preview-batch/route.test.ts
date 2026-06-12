import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { withAuthContextMock, careCaseFindFirstMock, buildVisitScheduleBillingPreviewBatchMock } =
  vi.hoisted(() => ({
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
    careCaseFindFirstMock: vi.fn(),
    buildVisitScheduleBillingPreviewBatchMock: vi.fn(),
  }));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: withAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    careCase: {
      findFirst: careCaseFindFirstMock,
    },
  },
}));

vi.mock('@/server/services/visit-schedule-billing-preview', () => ({
  buildVisitScheduleBillingPreviewBatch: buildVisitScheduleBillingPreviewBatchMock,
}));

import { POST } from './route';

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
    expect(buildVisitScheduleBillingPreviewBatchMock).toHaveBeenCalledWith(
      [
        {
          key: 'proposal_1',
          caseId: 'case_1',
          proposedDate: '2026-04-03',
          pharmacistId: undefined,
          siteId: undefined,
          visitType: undefined,
        },
        {
          key: 'schedule_1',
          caseId: 'case_1',
          proposedDate: '2026-04-05',
          pharmacistId: undefined,
          siteId: undefined,
          visitType: 'regular',
        },
      ],
      'org_1',
    );
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

  it('rejects non-object batch preview payloads before case lookup', async () => {
    const response = await POST(createPostRequest([]), emptyRouteContext);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(buildVisitScheduleBillingPreviewBatchMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON batch preview payloads before case lookup', async () => {
    const response = await POST(createMalformedJsonPostRequest(), emptyRouteContext);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
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
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(buildVisitScheduleBillingPreviewBatchMock).not.toHaveBeenCalled();
  });

  it('denies unassigned batch preview requests before calling the billing-preview service', async () => {
    careCaseFindFirstMock.mockResolvedValueOnce(null);

    const response = await POST(
      createPostRequest({
        items: [{ key: 'proposal_1', case_id: 'case_unassigned', proposed_date: '2026-04-03' }],
      }),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(buildVisitScheduleBillingPreviewBatchMock).not.toHaveBeenCalled();
  });
});
