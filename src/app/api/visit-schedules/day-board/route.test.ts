import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authContextMock,
  membershipFindManyMock,
  visitScheduleFindManyMock,
  dispenseTaskGroupByMock,
  taskGroupByMock,
  medicationCycleCountMock,
  proposalFindManyMock,
  facilityFindManyMock,
  contactLogFindFirstMock,
  pharmacistShiftFindManyMock,
} = vi.hoisted(() => ({
  authContextMock: { orgId: 'org_1', userId: 'user_1', role: 'admin' },
  membershipFindManyMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  dispenseTaskGroupByMock: vi.fn(),
  taskGroupByMock: vi.fn(),
  medicationCycleCountMock: vi.fn(),
  proposalFindManyMock: vi.fn(),
  facilityFindManyMock: vi.fn(),
  contactLogFindFirstMock: vi.fn(),
  pharmacistShiftFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<Record<string, string>> }) =>
      handler(req, authContextMock, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: { findMany: membershipFindManyMock },
    visitSchedule: { findMany: visitScheduleFindManyMock },
    dispenseTask: { groupBy: dispenseTaskGroupByMock },
    task: { groupBy: taskGroupByMock },
    medicationCycle: { count: medicationCycleCountMock },
    visitScheduleProposal: { findMany: proposalFindManyMock },
    facility: { findMany: facilityFindManyMock },
    visitScheduleContactLog: { findFirst: contactLogFindFirstMock },
    pharmacistShift: { findMany: pharmacistShiftFindManyMock },
  },
}));

import { GET } from './route';

function createRequest(date?: string) {
  const url = new URL('http://localhost/api/visit-schedules/day-board');
  if (date) url.searchParams.set('date', date);
  return new NextRequest(url, { headers: { 'x-org-id': 'org_1' } });
}

describe('/api/visit-schedules/day-board', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // ローカル(JST 想定)の朝。@db.Date 境界バグはこの時間帯で前日落ちしていた
    vi.setSystemTime(new Date(2026, 5, 12, 9, 0));
    vi.clearAllMocks();
    membershipFindManyMock.mockResolvedValue([
      { role: 'pharmacist', user: { id: 'user_1', name: '山田 太郎' } },
    ]);
    visitScheduleFindManyMock.mockResolvedValue([]);
    dispenseTaskGroupByMock.mockResolvedValue([]);
    taskGroupByMock.mockResolvedValue([]);
    medicationCycleCountMock.mockResolvedValue(0);
    proposalFindManyMock.mockResolvedValue([]);
    facilityFindManyMock.mockResolvedValue([]);
    contactLogFindFirstMock.mockResolvedValue(null);
    pharmacistShiftFindManyMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('queries scheduled_date with the UTC-midnight range for the local date key', async () => {
    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);

    const where = visitScheduleFindManyMock.mock.calls.at(0)?.[0]?.where;
    // ローカル 2026-06-12 → UTC midnight 範囲。ローカル深夜(6/11T15:00Z)を渡すと
    // Prisma の @db.Date 切り捨てで前日扱いになり、当日訪問が全件こぼれる(回帰防止)
    expect(where?.scheduled_date).toEqual({
      gte: new Date('2026-06-12T00:00:00.000Z'),
      lt: new Date('2026-06-13T00:00:00.000Z'),
    });
  });

  it('uses the explicit date query parameter as the local date key', async () => {
    const response = (await GET(createRequest('2026-06-20'), {
      params: Promise.resolve({}),
    }))!;
    expect(response.status).toBe(200);

    const where = visitScheduleFindManyMock.mock.calls.at(0)?.[0]?.where;
    expect(where?.scheduled_date).toEqual({
      gte: new Date('2026-06-20T00:00:00.000Z'),
      lt: new Date('2026-06-21T00:00:00.000Z'),
    });
  });

  it('drops members who are shift-unavailable for the day', async () => {
    membershipFindManyMock.mockResolvedValue([
      { role: 'pharmacist', user: { id: 'user_1', name: '山田 太郎' } },
      { role: 'clerk', user: { id: 'user_4', name: '田中 真' } },
    ]);
    pharmacistShiftFindManyMock.mockResolvedValue([{ user_id: 'user_4' }]);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.data.staff.map((member: { id: string }) => member.id)).toEqual(['user_1']);
    const shiftWhere = pharmacistShiftFindManyMock.mock.calls.at(0)?.[0]?.where;
    expect(shiftWhere?.available).toBe(false);
    expect(shiftWhere?.date).toEqual({
      gte: new Date('2026-06-12T00:00:00.000Z'),
      lt: new Date('2026-06-13T00:00:00.000Z'),
    });
  });

  it('compares proposal impact ranges with the stored UTC date values', async () => {
    proposalFindManyMock.mockResolvedValue([
      {
        id: 'proposal_1',
        visit_type: 'regular',
        proposal_status: 'proposed',
        proposed_date: new Date('2026-06-13T00:00:00.000Z'),
        time_window_start: null,
        time_window_end: null,
        proposed_pharmacist_id: 'user_1',
        case_: { patient: { name: '鈴木 修' } },
      },
    ]);
    visitScheduleFindManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        pharmacist_id: 'user_1',
        scheduled_date: new Date('2026-06-13T00:00:00.000Z'),
        time_window_start: null,
        time_window_end: null,
      },
    ]);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);
    const json = await response.json();

    const impactWhere = visitScheduleFindManyMock.mock.calls.at(1)?.[0]?.where;
    expect(impactWhere?.OR?.[0]?.scheduled_date).toEqual({
      gte: new Date('2026-06-13T00:00:00.000Z'),
      lt: new Date('2026-06-14T00:00:00.000Z'),
    });

    const proposal = json.data.pending_proposals[0];
    // 同日訪問 1 件(60分 + 移動30分)が余白試算に乗る = UTC 日付キー同士の一致が機能
    expect(proposal.idle_before_minutes).toBe(480 - 90);
    expect(proposal.proposed_date).toBe('2026-06-13');
  });
});
