import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { withAuthContextMock, dispenseAuditFindManyMock, dispenseAuditGroupByMock } = vi.hoisted(
  () => ({
    withAuthContextMock: vi.fn(
      (
        handler: (
          req: NextRequest,
          ctx: { orgId: string; userId: string; role: 'admin' },
          routeContext: { params: Promise<Record<string, never>> },
        ) => Promise<Response>,
      ) => {
        return (req: NextRequest, routeContext = emptyRouteContext) =>
          handler(req, { orgId: 'org_1', userId: 'admin_1', role: 'admin' }, routeContext);
      },
    ),
    dispenseAuditFindManyMock: vi.fn(),
    dispenseAuditGroupByMock: vi.fn(),
  }),
);

const emptyRouteContext = { params: Promise.resolve({}) };

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: withAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    dispenseAudit: {
      findMany: dispenseAuditFindManyMock,
      groupBy: dispenseAuditGroupByMock,
    },
  },
}));

import { GET } from './route';

function createRequest(search = '?days=30') {
  return new NextRequest(`http://localhost/api/admin/reject-reason-stats${search}`, {
    headers: { 'x-org-id': 'org_1' },
  });
}

function getLastSinceDays() {
  const call = dispenseAuditGroupByMock.mock.calls.at(-1)?.[0];
  const since = call?.where?.audited_at?.gte;
  if (!(since instanceof Date)) {
    throw new Error('audited_at.gte was not queried');
  }
  return (Date.now() - since.getTime()) / (24 * 60 * 60 * 1000);
}

describe('/api/admin/reject-reason-stats GET', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00.000Z'));
    vi.clearAllMocks();
    dispenseAuditGroupByMock.mockResolvedValue([
      {
        reject_reason_code: 'drug_name_mismatch',
        _count: { id: 1 },
      },
      {
        reject_reason_code: null,
        _count: { id: 1 },
      },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns reject reason counts for a validated period', async () => {
    const response = (await GET(createRequest('?days=%2010%20'), emptyRouteContext))!;

    expect(response.status).toBe(200);
    expect(getLastSinceDays()).toBe(10);
    expect(dispenseAuditGroupByMock).toHaveBeenCalledWith({
      by: ['reject_reason_code'],
      where: {
        org_id: 'org_1',
        result: 'rejected',
        audited_at: { gte: expect.any(Date) },
      },
      _count: {
        id: true,
      },
    });
    expect(dispenseAuditFindManyMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      data: {
        total_rejected: 2,
        period_days: 10,
        breakdown: [
          {
            code: 'drug_name_mismatch',
            label: '薬剤名不一致',
            count: 1,
            percentage: 50,
          },
          {
            code: 'other',
            label: 'その他',
            count: 1,
            percentage: 50,
          },
        ],
      },
    });
  });

  it('accepts zero-day period values without clamping', async () => {
    const response = (await GET(createRequest('?days=0'), emptyRouteContext))!;

    expect(response.status).toBe(200);
    expect(getLastSinceDays()).toBe(0);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        period_days: 0,
      },
    });
  });

  it.each(['', '20abc', '1e2', '10.0', '-5', '9999'])(
    'rejects malformed days=%s before querying audits',
    async (days) => {
      const response = (await GET(
        createRequest(`?days=${encodeURIComponent(days)}`),
        emptyRouteContext,
      ))!;

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '入力値が不正です',
      });
      expect(dispenseAuditGroupByMock).not.toHaveBeenCalled();
      expect(dispenseAuditFindManyMock).not.toHaveBeenCalled();
    },
  );
});
