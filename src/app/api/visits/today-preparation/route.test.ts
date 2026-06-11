import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authContextMock,
  visitScheduleFindManyMock,
  workflowExceptionFindManyMock,
  dispenseTaskFindManyMock,
  facilityFindManyMock,
  visitRecordCountMock,
} = vi.hoisted(() => ({
  authContextMock: { orgId: 'org_1', userId: 'user_1', role: 'admin' },
  visitScheduleFindManyMock: vi.fn(),
  workflowExceptionFindManyMock: vi.fn(),
  dispenseTaskFindManyMock: vi.fn(),
  facilityFindManyMock: vi.fn(),
  visitRecordCountMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<Record<string, string>> }) =>
      handler(req, authContextMock, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    visitSchedule: { findMany: visitScheduleFindManyMock },
    workflowException: { findMany: workflowExceptionFindManyMock },
    dispenseTask: { findMany: dispenseTaskFindManyMock },
    facility: { findMany: facilityFindManyMock },
    visitRecord: { count: visitRecordCountMock },
  },
}));

import { GET } from './route';

const ORIGINAL_TZ = process.env.TZ;

function createRequest() {
  return new NextRequest('http://localhost/api/visits/today-preparation');
}

describe('/api/visits/today-preparation', () => {
  beforeAll(() => {
    process.env.TZ = 'Asia/Tokyo';
  });

  afterAll(() => {
    if (ORIGINAL_TZ === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = ORIGINAL_TZ;
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    visitScheduleFindManyMock.mockResolvedValue([]);
    workflowExceptionFindManyMock.mockResolvedValue([]);
    dispenseTaskFindManyMock.mockResolvedValue([]);
    facilityFindManyMock.mockResolvedValue([]);
    visitRecordCountMock.mockResolvedValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns an empty preparation board when there are no schedules', async () => {
    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.data.cards).toEqual([]);
    expect(json.data.visit_count).toBe(0);
    expect(json.data.facility_patient_count).toBe(0);
  });

  it('JST 朝(UTC では前日)でも scheduled_date(@db.Date)をローカル日付の UTC レンジで比較する', async () => {
    vi.useFakeTimers();
    // JST 2026-06-12 08:00(UTC では 2026-06-11T23:00Z)
    vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);

    const where = visitScheduleFindManyMock.mock.calls[0][0].where;
    expect(where.scheduled_date.gte.toISOString()).toBe('2026-06-12T00:00:00.000Z');
    expect(where.scheduled_date.lt.toISOString()).toBe('2026-06-13T00:00:00.000Z');
  });
});
