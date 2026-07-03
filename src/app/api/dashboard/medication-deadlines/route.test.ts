import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  authContext,
  requireAuthContextMock,
  runWithRequestAuthContextMock,
  successMock,
  loggerErrorMock,
  withOrgContextMock,
  withRoutePerformanceMock,
  visitScheduleFindManyMock,
} = vi.hoisted(() => {
  const authContext = {
    orgId: 'org_1',
    userId: 'user_1',
    role: 'admin',
  };

  return {
    authContext,
    requireAuthContextMock: vi.fn(),
    runWithRequestAuthContextMock: vi.fn((_ctx, callback) => callback()),
    successMock: vi.fn(),
    loggerErrorMock: vi.fn(),
    withOrgContextMock: vi.fn(),
    withRoutePerformanceMock: vi.fn((_req, handler) => handler()),
    visitScheduleFindManyMock: vi.fn(),
  };
});

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/auth/request-context', () => ({
  runWithRequestAuthContext: runWithRequestAuthContextMock,
}));

vi.mock('@/lib/api/response', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/response')>();
  successMock.mockImplementation(actual.success);
  return {
    ...actual,
    success: successMock,
  };
});

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

const txMock = {
  visitSchedule: {
    findMany: visitScheduleFindManyMock,
  },
};

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/utils/performance', () => ({
  withRoutePerformance: withRoutePerformanceMock,
}));

import { GET as rawGET } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);

function createRequest(search = '?within_days=7') {
  return new NextRequest(`http://localhost/api/dashboard/medication-deadlines${search}`, {
    headers: { 'x-org-id': 'org_1' },
  });
}

function getLastDeadlineWindowDays() {
  const call = visitScheduleFindManyMock.mock.calls.at(-1)?.[0];
  const range = call?.where?.medication_end_date;
  if (!range?.gte || !range?.lte) {
    throw new Error('medication_end_date range was not queried');
  }
  return (range.lte.getTime() - range.gte.getTime()) / (24 * 60 * 60 * 1000);
}

describe('/api/dashboard/medication-deadlines', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00.000Z'));
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({ ctx: authContext });
    runWithRequestAuthContextMock.mockImplementation((_ctx, callback) => callback());
    withOrgContextMock.mockImplementation(async (_orgId, callback) => callback(txMock));
    withRoutePerformanceMock.mockImplementation((_req, handler) => handler());
    const today = new Date();
    const inTwoDays = new Date(today);
    inTwoDays.setDate(today.getDate() + 2);
    const inFiveDays = new Date(today);
    inFiveDays.setDate(today.getDate() + 5);
    visitScheduleFindManyMock.mockResolvedValue([
      {
        id: 'schedule_1',
        medication_end_date: inTwoDays,
      },
      {
        id: 'schedule_2',
        medication_end_date: inFiveDays,
      },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('splits medication deadlines into critical and warning buckets', async () => {
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
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(authContext, expect.any(Function));
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: authContext,
    });
    expect(successMock).toHaveBeenCalledWith({
      total: 2,
      critical: {
        count: 1,
        items: [expect.objectContaining({ id: 'schedule_1' })],
      },
      warning: {
        count: 1,
        items: [expect.objectContaining({ id: 'schedule_2' })],
      },
    });
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      total: 2,
      critical: { count: 1 },
      warning: { count: 1 },
    });
    expect(visitScheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          case_: {
            is: {
              org_id: 'org_1',
              patient: {
                is: {
                  org_id: 'org_1',
                },
              },
            },
          },
        }),
      }),
    );
  });

  it('remains compatible with protected direct calls that omit routeContext', async () => {
    const response = (await rawGET(createRequest()))!;

    expect(response.status).toBe(200);
    expect(withRoutePerformanceMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.any(Function),
    );
    expectSensitiveNoStore(response);
  });

  it('defaults within_days to 7 and preserves omitted limit semantics', async () => {
    const response = (await GET(createRequest('')))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(getLastDeadlineWindowDays()).toBe(7);
    expect(visitScheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: undefined,
      }),
    );
  });

  it('rejects padded within_days values before querying schedules', async () => {
    const response = (await GET(createRequest('?within_days=%207%20')))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'クエリパラメータが不正です',
      details: {
        within_days: ['within_days は整数で指定してください'],
      },
    });
    expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
  });

  it('filters medication deadlines for global search by patient name with a bounded limit', async () => {
    const response = (await GET(createRequest('?within_days=14&q=田中&limit=8')))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(visitScheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          case_: {
            is: {
              org_id: 'org_1',
              patient: {
                is: {
                  org_id: 'org_1',
                  name: {
                    contains: '田中',
                    mode: 'insensitive',
                  },
                },
              },
            },
          },
        }),
        take: 8,
      }),
    );
  });

  it('accepts the maximum medication deadline limit', async () => {
    const response = (await GET(createRequest('?within_days=14&limit=50')))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(visitScheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 50,
      }),
    );
  });

  it('rejects malformed within_days values before querying schedules', async () => {
    const response = (await GET(createRequest('?within_days=20abc')))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'クエリパラメータが不正です',
      details: {
        within_days: ['within_days は整数で指定してください'],
      },
    });
    expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects out-of-range within_days values before querying schedules', async () => {
    const lowerResponse = (await GET(createRequest('?within_days=-5')))!;
    expect(lowerResponse.status).toBe(400);
    expectSensitiveNoStore(lowerResponse);
    expect(visitScheduleFindManyMock).not.toHaveBeenCalled();

    const upperResponse = (await GET(createRequest('?within_days=9999')))!;
    expect(upperResponse.status).toBe(400);
    expectSensitiveNoStore(upperResponse);
    expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
  });

  it.each([
    ['?within_days=7&within_days=14', { within_days: ['within_days は1つだけ指定してください'] }],
    ['?limit=8&limit=9', { limit: ['limit は1つだけ指定してください'] }],
    ['?q=田中&q=佐藤', { q: ['q は1つだけ指定してください'] }],
    ['?q=', { q: ['q が不正です'] }],
    ['?q=%20田中', { q: ['q が不正です'] }],
    ['?q=田中%20', { q: ['q が不正です'] }],
    ['?limit=', { limit: ['limit は整数で指定してください'] }],
    ['?limit=%208%20', { limit: ['limit は整数で指定してください'] }],
    ['?limit=0', { limit: ['limit は1以上50以下で指定してください'] }],
    ['?limit=51', { limit: ['limit は1以上50以下で指定してください'] }],
    [`?q=${'あ'.repeat(101)}`, { q: ['q は100文字以内で指定してください'] }],
  ])(
    'rejects malformed medication deadline query "%s" before querying schedules',
    async (search, details) => {
      const response = (await GET(createRequest(search)))!;

      expect(response.status).toBe(400);
      expectSensitiveNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'クエリパラメータが不正です',
        details,
      });
      expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
    },
  );

  it('wraps auth failure responses in no-store headers before deadline DB reads', async () => {
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
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when deadline reads fail', async () => {
    const unsafeError = new Error(
      'raw patient raw medication deadline_secret SQL stack_secret raw-error text must not leak',
    );
    unsafeError.name = 'crafted-name.raw-patient.medication.deadline.SQL.stack.raw-error';
    visitScheduleFindManyMock.mockRejectedValueOnce(unsafeError);

    const response = (await GET(createRequest()))!;

    expect(response.status).toBe(500);
    expect(withRoutePerformanceMock).toHaveBeenCalledTimes(1);
    expectSensitiveNoStore(response);
    const body = await response.text();
    expect(body).toContain('INTERNAL_ERROR');
    expect(body).not.toContain('raw patient');
    expect(body).not.toContain('raw medication');
    expect(body).not.toContain('deadline_secret');
    expect(body).not.toContain('SQL');
    expect(body).not.toContain('stack_secret');
    expect(body).not.toContain('crafted-name');
    expect(body).not.toContain('raw-error');
    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'dashboard_medication_deadlines_unhandled_error',
        route: '/api/dashboard/medication-deadlines',
        method: 'GET',
        status: 500,
      },
      unsafeError,
    );
    const [routeContext, loggedError] = loggerErrorMock.mock.calls[0] ?? [];
    expect(routeContext).not.toHaveProperty('error_name');
    expect(loggedError).toBe(unsafeError);
    const logged = JSON.stringify(routeContext);
    expect(logged).not.toContain('raw patient');
    expect(logged).not.toContain('raw medication');
    expect(logged).not.toContain('deadline_secret');
    expect(logged).not.toContain('SQL');
    expect(logged).not.toContain('stack_secret');
    expect(logged).not.toContain('crafted-name');
    expect(logged).not.toContain('raw-error text');
  });
});
