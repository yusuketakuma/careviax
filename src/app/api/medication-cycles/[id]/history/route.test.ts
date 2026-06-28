import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const {
  requireAuthContextMock,
  runWithRequestAuthContextMock,
  loggerErrorMock,
  withRoutePerformanceMock,
  medicationCycleFindFirstMock,
  cycleTransitionLogFindManyMock,
  userFindManyMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn((_ctx, callback) => callback()),
  loggerErrorMock: vi.fn(),
  withRoutePerformanceMock: vi.fn((_req, handler) => handler()),
  medicationCycleFindFirstMock: vi.fn(),
  cycleTransitionLogFindManyMock: vi.fn(),
  userFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/auth/request-context', () => ({
  runWithRequestAuthContext: runWithRequestAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    medicationCycle: { findFirst: medicationCycleFindFirstMock },
    cycleTransitionLog: { findMany: cycleTransitionLogFindManyMock },
    user: { findMany: userFindManyMock },
  },
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/utils/performance', () => ({
  withRoutePerformance: withRoutePerformanceMock,
}));

import { GET } from './route';

function createRequest(url: string) {
  return new NextRequest(url);
}

function expectAuthAuditPathTemplate() {
  const authRequest = requireAuthContextMock.mock.calls[0]?.[0] as NextRequest | undefined;
  expect(authRequest?.nextUrl.pathname).toBe('/api/medication-cycles/[id]/history');
  expect(authRequest?.nextUrl.pathname).not.toContain('cycle_1');
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

const authCtx = {
  ctx: { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' },
};

describe('/api/medication-cycles/[id]/history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue(authCtx);
    runWithRequestAuthContextMock.mockImplementation((_ctx, callback) => callback());
    withRoutePerformanceMock.mockImplementation((_req, handler) => handler());
  });

  it('returns 200 with transition logs and no-store headers', async () => {
    medicationCycleFindFirstMock.mockResolvedValue({ id: 'cycle_1' });
    cycleTransitionLogFindManyMock.mockResolvedValue([
      {
        id: 'log_1',
        from_status: 'ready_to_dispense',
        to_status: 'dispensed',
        actor_id: 'user_1',
        note: null,
        created_at: '2026-01-01T00:00:00Z',
      },
    ]);
    userFindManyMock.mockResolvedValue([{ id: 'user_1', name: 'Taro' }]);

    const req = createRequest('http://localhost/api/medication-cycles/cycle_1/history');
    const res = await GET(req, { params: Promise.resolve({ id: '  cycle_1  ' }) });
    expect(res!.status).toBe(200);
    expectSensitiveNoStore(res!);
    expect(withRoutePerformanceMock).toHaveBeenCalledWith(req, expect.any(Function));
    expectAuthAuditPathTemplate();
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(authCtx.ctx, expect.any(Function));
    expect(medicationCycleFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'cycle_1',
        org_id: 'org_1',
      },
      select: { id: true },
    });
    expect(cycleTransitionLogFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { cycle_id: 'cycle_1', org_id: 'org_1' },
      }),
    );
    const json = await res!.json();
    expect(json).toHaveLength(1);
    expect(json[0].actor_name).toBe('Taro');
  });

  it('rejects blank cycle ids before loading cycle history', async () => {
    const req = createRequest('http://localhost/api/medication-cycles/%20%20%20/history');
    const res = await GET(req, { params: Promise.resolve({ id: '   ' }) });

    expect(res!.status).toBe(400);
    expectSensitiveNoStore(res!);
    await expect(res!.json()).resolves.toMatchObject({
      message: '処方サイクルIDが不正です',
    });
    expect(medicationCycleFindFirstMock).not.toHaveBeenCalled();
    expect(cycleTransitionLogFindManyMock).not.toHaveBeenCalled();
    expect(userFindManyMock).not.toHaveBeenCalled();
  });

  it('omits the assignment predicate for admin cycle history lookups', async () => {
    requireAuthContextMock.mockResolvedValue({
      ctx: { orgId: 'org_1', userId: 'admin_1', role: 'admin' },
    });
    medicationCycleFindFirstMock.mockResolvedValue({ id: 'cycle_1' });
    cycleTransitionLogFindManyMock.mockResolvedValue([]);

    const req = createRequest('http://localhost/api/medication-cycles/cycle_1/history');
    const res = await GET(req, { params: Promise.resolve({ id: 'cycle_1' }) });

    expect(res!.status).toBe(200);
    expectSensitiveNoStore(res!);
    expect(medicationCycleFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'cycle_1',
        org_id: 'org_1',
      },
      select: { id: true },
    });
  });

  it('returns 404 when cycle not found', async () => {
    medicationCycleFindFirstMock.mockResolvedValue(null);

    const req = createRequest('http://localhost/api/medication-cycles/missing/history');
    const res = await GET(req, { params: Promise.resolve({ id: 'missing' }) });
    expect(res!.status).toBe(404);
    expectSensitiveNoStore(res!);
    expect(cycleTransitionLogFindManyMock).not.toHaveBeenCalled();
    expect(userFindManyMock).not.toHaveBeenCalled();
  });

  it('wraps auth failure responses in no-store headers before loading cycle history', async () => {
    requireAuthContextMock.mockResolvedValue({
      response: NextResponse.json(
        { code: 'AUTH_FORBIDDEN', message: '処方サイクル履歴の閲覧権限がありません' },
        { status: 403 },
      ),
    });

    const req = createRequest('http://localhost/api/medication-cycles/cycle_1/history');
    const res = await GET(req, { params: Promise.resolve({ id: 'cycle_1' }) });

    expect(res!.status).toBe(403);
    expectSensitiveNoStore(res!);
    expectAuthAuditPathTemplate();
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(medicationCycleFindFirstMock).not.toHaveBeenCalled();
    expect(cycleTransitionLogFindManyMock).not.toHaveBeenCalled();
    expect(userFindManyMock).not.toHaveBeenCalled();
  });

  it('returns a no-store fixed error and PHI-safe log metadata when cycle history loading throws', async () => {
    const thrown = new Error(
      'cycle history failed for patient 山田太郎 note: 麻薬指導 SQL select stack trace',
    );
    thrown.name = 'cycle_1';
    medicationCycleFindFirstMock.mockRejectedValue(thrown);

    const req = createRequest('http://localhost/api/medication-cycles/cycle_1/history');
    const res = await GET(req, { params: Promise.resolve({ id: 'cycle_1' }) });

    expect(res!.status).toBe(500);
    expectSensitiveNoStore(res!);
    const body = await res!.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田太郎');
    expect(JSON.stringify(body)).not.toContain('麻薬指導');
    expect(JSON.stringify(body)).not.toContain('SQL select');

    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'medication_cycle_history_unhandled_error',
      undefined,
      {
        event: 'medication_cycle_history_unhandled_error',
        route: '/api/medication-cycles/[id]/history',
        method: 'GET',
        status: 500,
        error_name: 'Error',
      },
    );
    expect(loggerErrorMock.mock.calls[0]).not.toContain(thrown);
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('cycle_1');
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('山田太郎');
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('麻薬指導');
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('SQL select');
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('stack trace');
  });
});
