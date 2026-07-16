import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { operationsInsightsResponseSchema } from '@/lib/analytics/operations-insights-response-schema';

const { queryRawMock } = vi.hoisted(() => ({ queryRawMock: vi.fn() }));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext:
    (handler: (req: NextRequest, ctx: { orgId: string }) => Promise<Response>) =>
    (req: NextRequest) =>
      handler(req, { orgId: 'org_1' }),
}));

vi.mock('@/lib/db/client', () => ({ prisma: { $queryRaw: queryRawMock } }));

import { GET } from './route';

describe('/api/admin/operations-insights', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T01:00:00.000Z'));
    queryRawMock
      .mockResolvedValueOnce([
        { month_key: '2026-05', count: BigInt(10) },
        { month_key: '2026-06', count: BigInt(4) },
      ])
      .mockResolvedValueOnce([
        { key: 'audit', average_minutes: 45, sample_count: BigInt(4) },
        { key: 'visit', average_minutes: 90, sample_count: BigInt(6) },
        { key: 'report', average_minutes: null, sample_count: BigInt(0) },
      ])
      .mockResolvedValueOnce([{ current_count: BigInt(4), previous_count: BigInt(3) }]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('returns bounded DB aggregates with equal JST comparison windows and explicit event semantics', async () => {
    const response = await GET(new NextRequest('http://localhost/api/admin/operations-insights'), {
      params: Promise.resolve({}),
    });
    expect(response?.status).toBe(200);
    const body = await response?.json();
    expect(() => operationsInsightsResponseSchema.parse(body)).not.toThrow();
    expect(queryRawMock).toHaveBeenCalledTimes(3);
    const processQuery = queryRawMock.mock.calls[1]?.[0] as { strings: string[] };
    expect(processQuery.strings.join('')).toContain('"voided_at" IS NULL');
    expect(body.data.monthly_visits.map((bucket: { count: number }) => bucket.count)).toEqual([
      0, 0, 0, 10, 4,
    ]);
    expect(body.data.processes).toEqual([
      expect.objectContaining({
        key: 'intake',
        sampleCount: 0,
        completedEvent: '完了イベント未定義',
      }),
      expect.objectContaining({
        key: 'audit',
        averageMinutes: 45,
        sampleCount: 4,
        completedEvent: '監査実施',
      }),
      expect.objectContaining({ key: 'set', sampleCount: 0, completedEvent: '完了イベント未定義' }),
      expect.objectContaining({
        key: 'visit',
        averageMinutes: 90,
        sampleCount: 6,
        completedEvent: '訪問終了',
      }),
      expect.objectContaining({
        key: 'report',
        averageMinutes: 0,
        sampleCount: 0,
        completedEvent: '報告確定',
      }),
    ]);
    const currentMs =
      Date.parse(body.data.comparison.current.end) - Date.parse(body.data.comparison.current.start);
    const previousMs =
      Date.parse(body.data.comparison.previous.end) -
      Date.parse(body.data.comparison.previous.start);
    expect(currentMs).toBe(previousMs);
    expect(body.data.hints).toContain('訪問件数は前月より1件増えています');
  });
});
