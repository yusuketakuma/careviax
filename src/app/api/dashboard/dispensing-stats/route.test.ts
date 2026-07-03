import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  authContextMock,
  requireAuthContextMock,
  runWithRequestAuthContextMock,
  loggerErrorMock,
  withRoutePerformanceMock,
  dispenseTaskCountMock,
  medicationCycleCountMock,
} = vi.hoisted(() => ({
  authContextMock: { orgId: 'org_1', userId: 'user_1', role: 'admin' },
  requireAuthContextMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn((_ctx, callback) => callback()),
  loggerErrorMock: vi.fn(),
  withRoutePerformanceMock: vi.fn((_req, handler) => handler()),
  dispenseTaskCountMock: vi.fn(),
  medicationCycleCountMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/auth/request-context', () => ({
  runWithRequestAuthContext: runWithRequestAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    dispenseTask: {
      count: dispenseTaskCountMock,
    },
    medicationCycle: {
      count: medicationCycleCountMock,
    },
  },
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/utils/performance', () => ({
  withRoutePerformance: withRoutePerformanceMock,
}));

import { GET as rawGET } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);

function createRequest() {
  return new NextRequest('http://localhost/api/dashboard/dispensing-stats', {
    headers: { 'x-org-id': 'org_1' },
  });
}

describe('/api/dashboard/dispensing-stats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({ ctx: authContextMock });
    runWithRequestAuthContextMock.mockImplementation((_ctx, callback) => callback());
    withRoutePerformanceMock.mockImplementation((_req, handler) => handler());
    dispenseTaskCountMock
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(5);
    medicationCycleCountMock.mockResolvedValueOnce(1);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('wraps auth failure responses in no-store headers before count reads', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: NextResponse.json({ code: 'AUTH_FORBIDDEN' }, { status: 403 }),
    });

    const response = (await GET(createRequest()))!;

    expect(response.status).toBe(403);
    expect(withRoutePerformanceMock).toHaveBeenCalledTimes(1);
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canViewDashboard',
      message: 'ダッシュボードの閲覧権限がありません',
    });
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(dispenseTaskCountMock).not.toHaveBeenCalled();
    expect(medicationCycleCountMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it('returns dispensing dashboard metrics', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-11T15:30:00.000Z')); // 2026-06-12 00:30 JST

    const response = (await GET(createRequest()))!;

    expect(response.status).toBe(200);
    expect(withRoutePerformanceMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.any(Function),
    );
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canViewDashboard',
      message: 'ダッシュボードの閲覧権限がありません',
    });
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(
      authContextMock,
      expect.any(Function),
    );
    expectSensitiveNoStore(response);
    const json = await response.json();
    expect(json).toMatchObject({
      pendingTasks: 3,
      auditPendingTasks: 2,
      completedToday: 5,
      prescriptionRegisteredWithoutDispenseTasks: 1,
    });
    expect(json).not.toHaveProperty('completedLast7Days');
    expect(dispenseTaskCountMock).toHaveBeenCalledTimes(3);
    expect(dispenseTaskCountMock).toHaveBeenNthCalledWith(1, {
      where: {
        org_id: 'org_1',
        status: 'pending',
      },
    });
    expect(dispenseTaskCountMock).toHaveBeenNthCalledWith(2, {
      where: {
        org_id: 'org_1',
        status: 'completed',
        audits: { none: {} },
      },
    });
    expect(dispenseTaskCountMock).toHaveBeenNthCalledWith(3, {
      where: {
        org_id: 'org_1',
        status: 'completed',
        updated_at: {
          gte: new Date('2026-06-11T15:00:00.000Z'),
          lt: new Date('2026-06-12T15:00:00.000Z'),
        },
      },
    });
    expect(medicationCycleCountMock).toHaveBeenCalledTimes(1);
    expect(medicationCycleCountMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        overall_status: { in: ['ready_to_dispense', 'dispensing'] },
        prescription_intakes: { some: {} },
        dispense_tasks: { none: {} },
      },
    });
  });

  it('remains compatible with direct calls that omit routeContext', async () => {
    const response = await rawGET(createRequest());

    expect(response.status).toBe(200);
    expect(withRoutePerformanceMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.any(Function),
    );
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canViewDashboard',
      message: 'ダッシュボードの閲覧権限がありません',
    });
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(
      authContextMock,
      expect.any(Function),
    );
    expectSensitiveNoStore(response);
  });

  it('returns a sanitized no-store 500 when metric reads fail', async () => {
    const rawError =
      'raw-dispensing raw-dashboard raw-SQL raw-stack crafted-name raw-error count failure must not leak';
    const unsafeError = new Error(rawError);
    unsafeError.name = 'crafted-name.raw-dispensing.raw-dashboard.raw-SQL.raw-stack.raw-error';
    dispenseTaskCountMock.mockReset();
    dispenseTaskCountMock.mockRejectedValueOnce(unsafeError);

    const response = (await GET(createRequest()))!;

    expect(response.status).toBe(500);
    expect(withRoutePerformanceMock).toHaveBeenCalledTimes(1);
    expectSensitiveNoStore(response);
    const body = await response.text();
    expect(body).toContain('INTERNAL_ERROR');
    expect(body).not.toContain('raw-dispensing');
    expect(body).not.toContain('raw-dashboard');
    expect(body).not.toContain('raw-SQL');
    expect(body).not.toContain('raw-stack');
    expect(body).not.toContain('crafted-name');
    expect(body).not.toContain('raw-error');
    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'dashboard_dispensing_stats_unhandled_error',
        route: '/api/dashboard/dispensing-stats',
        method: 'GET',
        status: 500,
      },
      unsafeError,
    );
    expect(loggerErrorMock.mock.calls[0]?.[0]).not.toHaveProperty('error_name');
    const loggedContext = JSON.stringify(loggerErrorMock.mock.calls[0]?.[0]);
    expect(loggedContext).not.toContain('raw-dispensing');
    expect(loggedContext).not.toContain('raw-dashboard');
    expect(loggedContext).not.toContain('raw-SQL');
    expect(loggedContext).not.toContain('raw-stack');
    expect(loggedContext).not.toContain('crafted-name');
    expect(loggedContext).not.toContain('raw-error');
  });
});
