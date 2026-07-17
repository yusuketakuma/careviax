import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getPerformanceSnapshot, resetPerformanceMetrics } from '@/lib/utils/performance';

const {
  authMock,
  membershipFindFirstMock,
  dispenseTaskFindManyMock,
  withOrgContextMock,
  loggerErrorMock,
  clearRequestAuthContextMock,
  runWithRequestAuthContextMock,
  unstableRethrowMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  dispenseTaskFindManyMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  clearRequestAuthContextMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn((_ctx, callback: () => unknown) => callback()),
  unstableRethrowMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({ unstable_rethrow: unstableRethrowMock }));

vi.mock('@/lib/auth/request-context', () => ({
  clearRequestAuthContext: clearRequestAuthContextMock,
  runWithRequestAuthContext: runWithRequestAuthContextMock,
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

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock },
}));

import { GET } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };

function createRequest() {
  return new NextRequest('http://localhost/api/dispense-queue', {
    headers: {
      'x-org-id': 'org_1',
    },
  });
}

describe('/api/dispense-queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPerformanceMetrics();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    runWithRequestAuthContextMock.mockImplementation((_ctx, callback) => callback());
    unstableRethrowMock.mockImplementation(() => undefined);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        dispenseTask: {
          findMany: dispenseTaskFindManyMock,
        },
      }),
    );
    dispenseTaskFindManyMock.mockResolvedValue([
      {
        id: 'task_1',
        priority: 'urgent',
        due_date: null,
        created_at: new Date('2026-03-29T00:00:00.000Z'),
        results: [],
        cycle: {
          case_: {
            patient: {
              residences: [{ building_id: 'facility_1', address: '施設A' }],
            },
          },
          inquiries: [],
          prescription_intakes: [],
        },
      },
    ]);
  });

  it('returns a sorted dispense queue with facility labels', async () => {
    dispenseTaskFindManyMock.mockResolvedValue([
      {
        id: 'task_2',
        priority: 'normal',
        due_date: new Date('2026-03-30T10:00:00.000Z'),
        created_at: new Date('2026-03-29T12:00:00.000Z'),
        results: [],
        cycle: {
          case_: {
            patient: {
              residences: [{ building_id: 'facility_2', address: '施設B' }],
            },
          },
          inquiries: [],
          prescription_intakes: [],
        },
      },
      {
        id: 'task_1',
        priority: 'urgent',
        due_date: new Date('2026-03-29T08:00:00.000Z'),
        created_at: new Date('2026-03-29T00:00:00.000Z'),
        results: [],
        cycle: {
          case_: {
            patient: {
              residences: [{ building_id: 'facility_1', address: '施設A' }],
            },
          },
          inquiries: [],
          prescription_intakes: [],
        },
      },
    ]);

    const response = (await GET(createRequest(), emptyRouteContext))!;

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(response.headers.get('X-Request-Id')).toBeTruthy();
    expect(response.headers.get('X-Correlation-Id')).toBeTruthy();
    expect(runWithRequestAuthContextMock).toHaveBeenCalledTimes(2);
    expect(runWithRequestAuthContextMock.mock.calls[0]?.[0]).toBe(
      runWithRequestAuthContextMock.mock.calls[1]?.[0],
    );
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      }),
      maxWaitMs: 10_000,
      timeoutMs: 20_000,
    });
    const responseBody = await response.text();
    const responseBytes = new TextEncoder().encode(responseBody).length;
    expect(response.headers.get('Content-Length')).toBe(String(responseBytes));
    expect(JSON.parse(responseBody)).toMatchObject({
      data: [
        expect.objectContaining({
          id: 'task_1',
          facility_label: 'facility_1',
          is_overdue: true,
        }),
        expect.objectContaining({
          id: 'task_2',
          facility_label: 'facility_2',
        }),
      ],
    });
    expect(
      getPerformanceSnapshot({ topRoutes: 100 }).routes.find(
        (route) => route.method === 'GET' && route.route === '/api/dispense-queue',
      ),
    ).toMatchObject({
      payload_sample_count: 1,
      last_payload_bytes: responseBytes,
    });
    // 新ポリシー: pharmacist は組織内フルアクセス(担当割当スコープ撤廃)のため
    // WHERE は org-only になり、cycle の担当割当 OR 句は付与されない。
    expect(dispenseTaskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          status: { in: ['pending', 'in_progress'] },
        },
      }),
    );
  });

  it('rejects insufficient permission before request context or RLS work', async () => {
    membershipFindFirstMock.mockResolvedValueOnce({ role: 'clerk' });

    const response = (await GET(createRequest(), emptyRouteContext))!;

    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    await expect(response.json()).resolves.toMatchObject({
      message: '調剤キューの閲覧権限がありません',
    });
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(dispenseTaskFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects missing authentication before membership or RLS work', async () => {
    authMock.mockResolvedValueOnce(null);

    const response = (await GET(createRequest(), emptyRouteContext))!;

    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(membershipFindFirstMock).not.toHaveBeenCalled();
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns a generated-trace safe 500 when authentication dependencies throw', async () => {
    const unsafeError = new Error('患者 山田花子 raw dispense queue auth secret');
    unsafeError.name = 'DispenseQueueAuthSecretError';
    authMock.mockRejectedValueOnce(unsafeError);

    const response = (await GET(createRequest(), emptyRouteContext))!;
    const requestId = response.headers.get('X-Request-Id');
    const correlationId = response.headers.get('X-Correlation-Id');

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(requestId).toBeTruthy();
    expect(correlationId).toBe(requestId);
    await expect(response.json()).resolves.toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledOnce();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_auth_unhandled_error',
        route: '/api/dispense-queue',
        method: 'GET',
        requestId,
        correlationId,
      },
      unsafeError,
    );
    const loggedContext = JSON.stringify(loggerErrorMock.mock.calls[0]?.[0]);
    expect(loggedContext).not.toContain('山田花子');
    expect(loggedContext).not.toContain('DispenseQueueAuthSecretError');
  });

  it('returns a sanitized no-store 500 when queue lookup fails unexpectedly', async () => {
    const unsafeError = new Error(
      '患者 山田花子 東京都千代田区1-1-1 raw dispense queue drug inquiry',
    );
    unsafeError.name = 'DispenseQueuePatientSecretError';
    dispenseTaskFindManyMock.mockRejectedValueOnce(unsafeError);

    const response = (await GET(createRequest(), emptyRouteContext))!;

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    const requestId = response.headers.get('X-Request-Id');
    const correlationId = response.headers.get('X-Correlation-Id');
    expect(requestId).toBeTruthy();
    expect(correlationId).toBeTruthy();
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田花子');
    expect(JSON.stringify(body)).not.toContain('東京都千代田区1-1-1');
    expect(JSON.stringify(body)).not.toContain('raw dispense queue drug inquiry');
    expect(loggerErrorMock).toHaveBeenCalledOnce();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_handler_unhandled_error',
        route: '/api/dispense-queue',
        method: 'GET',
        requestId,
        correlationId,
      },
      unsafeError,
    );
    expect(loggerErrorMock.mock.calls[0]?.[0]).not.toHaveProperty('error_name');
    const loggedContext = JSON.stringify(loggerErrorMock.mock.calls[0]?.[0]);
    expect(loggedContext).not.toContain('山田花子');
    expect(loggedContext).not.toContain('東京都千代田区1-1-1');
    expect(loggedContext).not.toContain('DispenseQueuePatientSecretError');
    expect(loggedContext).not.toContain('raw dispense queue drug inquiry');
    expect(loggedContext).not.toContain('patient');
    expect(loggedContext).not.toContain('drug');
    expect(loggedContext).not.toContain('inquiry');
  });

  it('rethrows authentication control flow without logging or query work', async () => {
    const controlFlowError = new Error('NEXT_REDIRECT');
    authMock.mockRejectedValueOnce(controlFlowError);
    unstableRethrowMock.mockImplementationOnce((error) => {
      throw error;
    });

    await expect(GET(createRequest(), emptyRouteContext)).rejects.toBe(controlFlowError);

    expect(loggerErrorMock).not.toHaveBeenCalled();
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rethrows handler control flow without shared logging', async () => {
    const controlFlowError = new Error('NEXT_NOT_FOUND');
    dispenseTaskFindManyMock.mockRejectedValueOnce(controlFlowError);
    unstableRethrowMock.mockImplementationOnce((error) => {
      throw error;
    });

    await expect(GET(createRequest(), emptyRouteContext)).rejects.toBe(controlFlowError);

    expect(loggerErrorMock).not.toHaveBeenCalled();
  });
});
