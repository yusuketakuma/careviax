import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { withAuthContextMock, withOrgContextMock, buildTodayOpsRailMock, tx } = vi.hoisted(() => {
  const tx = {
    drugMaster: { count: vi.fn(), findFirst: vi.fn() },
    externalProfessional: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    prescriberInstitution: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    facility: { count: vi.fn(), findFirst: vi.fn() },
    membership: { count: vi.fn(), findFirst: vi.fn() },
    pcaPump: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    visitVehicleResource: { findMany: vi.fn() },
    pharmacySite: { count: vi.fn(), findFirst: vi.fn() },
    serviceArea: { count: vi.fn() },
    packagingMethodMaster: { count: vi.fn(), findFirst: vi.fn() },
    template: { count: vi.fn(), findFirst: vi.fn() },
    billingRule: { count: vi.fn(), findFirst: vi.fn() },
    auditLog: { count: vi.fn() },
  };
  return {
    withAuthContextMock: vi.fn(),
    withOrgContextMock: vi.fn(),
    buildTodayOpsRailMock: vi.fn(),
    tx,
  };
});

const emptyRouteContext = { params: Promise.resolve({}) };
const authContext = {
  orgId: 'org_1',
  userId: 'user_1',
  role: 'admin',
  ipAddress: '127.0.0.1',
  userAgent: 'vitest',
};

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: typeof authContext,
      routeContext: typeof emptyRouteContext,
    ) => Promise<Response>,
    options: unknown,
  ) => {
    withAuthContextMock(handler, options);
    return (req: NextRequest, routeContext = emptyRouteContext) =>
      handler(req, authContext, routeContext);
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/today-ops-rail', () => ({
  buildTodayOpsRail: buildTodayOpsRailMock,
}));

import { GET } from './route';

function createRequest() {
  return new NextRequest('http://localhost/api/admin/master-hub', {
    headers: { 'x-org-id': 'org_1' },
  });
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

function findMaster(body: unknown, key: string) {
  const masters = (body as { data: { masters: Array<{ key: string }> } }).data.masters;
  const card = masters.find((item) => item.key === key);
  if (!card) throw new Error(`missing master card: ${key}`);
  return card as unknown as {
    action_href: string;
    action_label: string;
    note: string;
    next_action_hint: string;
    issue_count: number;
    status: string;
    status_count: number | null;
  };
}

describe('/api/admin/master-hub', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 11, 9, 42));

    tx.drugMaster.count.mockResolvedValue(1248);
    tx.drugMaster.findFirst.mockResolvedValue({ updated_at: new Date('2026-06-10T00:00:00Z') });
    tx.externalProfessional.count.mockResolvedValue(44);
    tx.externalProfessional.findMany.mockResolvedValue([]);
    tx.externalProfessional.findFirst.mockResolvedValue({
      updated_at: new Date('2026-06-10T00:00:00Z'),
    });
    tx.prescriberInstitution.count.mockResolvedValue(42);
    tx.prescriberInstitution.findMany.mockResolvedValue([]);
    tx.prescriberInstitution.findFirst.mockResolvedValue({
      updated_at: new Date('2026-06-11T00:12:00Z'),
    });
    tx.facility.count.mockResolvedValue(12);
    tx.facility.findFirst.mockResolvedValue({
      name: 'グリーンヒル',
      updated_at: new Date('2026-06-09T00:00:00Z'),
    });
    tx.membership.count.mockResolvedValue(8);
    tx.membership.findFirst.mockResolvedValue({ updated_at: new Date('2026-06-11T00:00:00Z') });
    tx.pcaPump.count.mockResolvedValue(4);
    tx.pcaPump.findMany.mockResolvedValue([]);
    tx.pcaPump.findFirst.mockResolvedValue({ updated_at: new Date('2026-06-08T00:00:00Z') });
    tx.visitVehicleResource.findMany.mockResolvedValue([
      {
        label: '軽バン2号',
        available: true,
        notes: null,
        next_inspection_date: new Date('2026-06-20T00:00:00Z'),
        updated_at: new Date('2026-06-02T00:00:00Z'),
      },
    ]);
    tx.pharmacySite.count.mockResolvedValue(2);
    tx.pharmacySite.findFirst.mockResolvedValue({
      name: '本店',
      updated_at: new Date('2026-06-08T00:00:00Z'),
    });
    tx.serviceArea.count.mockResolvedValue(3);
    tx.packagingMethodMaster.count.mockResolvedValue(3);
    tx.packagingMethodMaster.findFirst.mockResolvedValue({
      updated_at: new Date('2026-06-09T00:00:00Z'),
    });
    tx.template.count.mockResolvedValue(4);
    tx.template.findFirst.mockResolvedValue({ updated_at: new Date('2026-06-09T00:00:00Z') });
    tx.billingRule.count.mockResolvedValue(18);
    tx.billingRule.findFirst.mockResolvedValue({ updated_at: new Date('2026-06-07T00:00:00Z') });
    tx.auditLog.count.mockResolvedValue(18);
    buildTodayOpsRailMock.mockResolvedValue({
      next_action: {
        label: '麻薬監査を開始',
        description: '持参薬の確認',
        href: '/audit',
      },
      blocked_reasons: [],
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) => callback(tx));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns no-store master cards whose root actions stay inside master administration', async () => {
    const response = await GET(createRequest(), emptyRouteContext);

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);

    const body = await response.json();
    expect(findMaster(body, 'facilities')).toMatchObject({
      action_label: '→ 施設へ',
      action_href: '/admin/facilities',
    });
    expect(findMaster(body, 'staff')).toMatchObject({
      action_label: '→ スタッフへ',
      action_href: '/admin/staff',
    });
    expect(findMaster(body, 'vehicles')).toMatchObject({
      action_label: '点検を予約',
      action_href: '/admin/vehicles',
    });
  });

  it('counts the master change log by the JST month on a UTC runtime (master-hub)', async () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      // JST 2026-06-12 08:00(UTC では 2026-06-11T23:00Z)。JST 民間月 2026-06 の月初実時刻は
      // 2026-05-31T15:00Z。startOfMonth(now)(ローカル月初)だと 2026-06-01T00:00Z にずれる。
      vi.setSystemTime(new Date('2026-06-11T23:00:00Z'));

      const response = await GET(createRequest(), emptyRouteContext);
      expect(response.status).toBe(200);

      const where = tx.auditLog.count.mock.calls.at(-1)?.[0]?.where;
      expect(where.created_at.gte.toISOString()).toBe('2026-05-31T15:00:00.000Z');
    } finally {
      if (originalTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimezone;
      }
    }
  });

  it('marks an expired vehicle inspection as blocked freshness instead of due soon', async () => {
    tx.visitVehicleResource.findMany.mockResolvedValueOnce([
      {
        label: '軽バン2号',
        available: true,
        notes: null,
        next_inspection_date: new Date('2026-06-01T00:00:00Z'),
        updated_at: new Date('2026-06-02T00:00:00Z'),
      },
    ]);

    const response = await GET(createRequest(), emptyRouteContext);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(findMaster(body, 'vehicles')).toMatchObject({
      status: 'expired',
      status_count: null,
      issue_count: 1,
      next_action_hint: '軽バン2号を配車候補から外して点検を予約する',
      note: '軽バン2号の点検期限 6/1 が10日過ぎています — 配車候補から除外して点検を予約してください',
    });
  });

  it('returns a sanitized no-store 500 when the master hub aggregate fails', async () => {
    withOrgContextMock.mockRejectedValueOnce(
      new Error('raw master hub failure patient 山田太郎 token secret'),
    );

    const response = await GET(createRequest(), emptyRouteContext);

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田太郎');
    expect(JSON.stringify(body)).not.toContain('token secret');
  });
});
