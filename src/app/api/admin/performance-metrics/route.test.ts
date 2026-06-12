import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { recordRoutePerformance, resetPerformanceMetrics } from '@/lib/utils/performance';

const { authMock, membershipFindFirstMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
  },
}));

const emptyRouteContext = { params: Promise.resolve({}) };

import { GET } from './route';

function createRequest(search = '?top=2', headers?: Record<string, string>) {
  const url = `http://localhost/api/admin/performance-metrics${search}`;
  return new NextRequest(url, {
    method: 'GET',
    headers,
  });
}

describe('/api/admin/performance-metrics GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPerformanceMetrics();
  });

  it('returns current-process latency snapshot for admins', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    recordRoutePerformance({
      route: '/api/visit-schedules',
      method: 'GET',
      status: 200,
      durationMs: 220,
    });
    recordRoutePerformance({
      route: '/api/visit-schedules',
      method: 'GET',
      status: 200,
      durationMs: 640,
    });
    recordRoutePerformance({
      route: '/api/dashboard/workflow',
      method: 'GET',
      status: 503,
      durationMs: 510,
    });

    const response = await GET(
      createRequest('?top=%202%20', { 'x-org-id': 'org_1' }),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        scope: 'current-process',
        target_ms: 500,
        summary: {
          total_requests: 3,
          slow_requests: 2,
          error_requests: 1,
          overall_p95_ms: 640,
          routes_over_target: 2,
        },
        routes: [
          {
            route: '/api/visit-schedules',
            method: 'GET',
            request_count: 2,
            p95_ms: 640,
          },
          {
            route: '/api/dashboard/workflow',
            method: 'GET',
            request_count: 1,
            p95_ms: 510,
          },
        ],
      },
    });
  });

  it.each(['', '1e1', '2.0', '2abc', '0', '21'])(
    'rejects malformed top=%s before returning a snapshot',
    async (top) => {
      authMock.mockResolvedValue({ user: { id: 'admin_1' } });
      membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

      recordRoutePerformance({
        route: '/api/visit-schedules',
        method: 'GET',
        status: 200,
        durationMs: 220,
      });

      const response = await GET(
        createRequest(`?top=${encodeURIComponent(top)}`, { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '入力値が不正です',
      });
    },
  );
});
