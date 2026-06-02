import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type AuthenticatedTestRequest = NextRequest & {
  orgId: string;
  userId: string;
  role: 'admin';
};

const { withAuthMock, dispenseAuditFindManyMock } = vi.hoisted(() => ({
  withAuthMock: vi.fn((handler: (req: AuthenticatedTestRequest) => Promise<Response>) => {
    return (req: NextRequest) =>
      handler(
        Object.assign(req, {
          orgId: 'org_1',
          userId: 'admin_1',
          role: 'admin' as const,
        }),
      );
  }),
  dispenseAuditFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: withAuthMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    dispenseAudit: {
      findMany: dispenseAuditFindManyMock,
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
  const call = dispenseAuditFindManyMock.mock.calls.at(-1)?.[0];
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
    dispenseAuditFindManyMock.mockResolvedValue([
      {
        reject_reason_code: 'drug_name_mismatch',
        reject_reason: null,
        audited_at: new Date('2026-05-31T00:00:00.000Z'),
      },
      {
        reject_reason_code: null,
        reject_reason: '自由記載',
        audited_at: new Date('2026-05-30T00:00:00.000Z'),
      },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns reject reason counts for a validated period', async () => {
    const response = (await GET(createRequest('?days=%2010%20')))!;

    expect(response.status).toBe(200);
    expect(getLastSinceDays()).toBe(10);
    expect(dispenseAuditFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        result: 'rejected',
        audited_at: { gte: expect.any(Date) },
      },
      select: {
        reject_reason_code: true,
        reject_reason: true,
        audited_at: true,
      },
      orderBy: { audited_at: 'desc' },
    });
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
    const response = (await GET(createRequest('?days=0')))!;

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
      const response = (await GET(createRequest(`?days=${encodeURIComponent(days)}`)))!;

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '入力値が不正です',
      });
      expect(dispenseAuditFindManyMock).not.toHaveBeenCalled();
    },
  );
});
