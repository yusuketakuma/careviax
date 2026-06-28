import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const {
  authContext,
  requireAuthContextMock,
  runWithRequestAuthContextMock,
  loggerErrorMock,
  withRoutePerformanceMock,
  careCaseFindManyMock,
  visitScheduleCountMock,
  careReportCountMock,
  taskCountMock,
} = vi.hoisted(() => {
  const authContext = {
    orgId: 'org_1',
    userId: 'user_1',
    role: 'clerk',
  };

  return {
    authContext,
    requireAuthContextMock: vi.fn(),
    runWithRequestAuthContextMock: vi.fn((_ctx, callback) => callback()),
    loggerErrorMock: vi.fn(),
    withRoutePerformanceMock: vi.fn((_req, handler) => handler()),
    careCaseFindManyMock: vi.fn(),
    visitScheduleCountMock: vi.fn(),
    careReportCountMock: vi.fn(),
    taskCountMock: vi.fn(),
  };
});

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/auth/request-context', () => ({
  runWithRequestAuthContext: runWithRequestAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    careCase: {
      findMany: careCaseFindManyMock,
    },
    visitSchedule: {
      count: visitScheduleCountMock,
    },
    careReport: {
      count: careReportCountMock,
    },
    task: {
      count: taskCountMock,
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

function createRequest(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/dashboard/overdue', {
    headers,
  });
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/dashboard/overdue GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({ ctx: authContext });
    runWithRequestAuthContextMock.mockImplementation((_ctx, callback) => callback());
    withRoutePerformanceMock.mockImplementation((_req, handler) => handler());
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1', patient_id: 'patient_1' }]);
    visitScheduleCountMock.mockResolvedValue(1);
    careReportCountMock.mockResolvedValue(1);
    taskCountMock.mockResolvedValue(1);
  });

  it('returns 403 when the role lacks dashboard permission', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: NextResponse.json({ code: 'AUTH_FORBIDDEN' }, { status: 403 }),
    });

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }));

    if (!response) throw new Error('response is required');
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
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(visitScheduleCountMock).not.toHaveBeenCalled();
    expect(careReportCountMock).not.toHaveBeenCalled();
    expect(taskCountMock).not.toHaveBeenCalled();
  });

  it('returns overdue dashboard buckets', async () => {
    const response = await GET(createRequest({ 'x-org-id': 'org_1' }));

    if (!response) throw new Error('response is required');
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
    expectSensitiveNoStore(response);
    expect(careCaseFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        AND: [
          {
            OR: [
              { primary_pharmacist_id: 'user_1' },
              { backup_pharmacist_id: 'user_1' },
              { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
            ],
          },
        ],
      },
      select: { id: true, patient_id: true },
    });
    expect(visitScheduleCountMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          case_id: { in: ['case_1'] },
        }),
      }),
    );
    expect(careReportCountMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          patient_id: { in: ['patient_1'] },
        }),
      }),
    );
    expect(taskCountMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          AND: expect.arrayContaining([
            {
              OR: expect.arrayContaining([
                {
                  assigned_to: 'user_1',
                },
                {
                  related_entity_type: 'patient',
                  related_entity_id: { in: ['patient_1'] },
                },
                {
                  related_entity_type: 'case',
                  related_entity_id: { in: ['case_1'] },
                },
              ]),
            },
          ]),
        }),
      }),
    );
    const json = await response.json();
    expect(json).toMatchObject({
      summary: {
        unrecorded_visits: 1,
        unsent_reports: 1,
        overdue_tasks: 1,
        total: 3,
      },
    });
    expect(json).not.toHaveProperty('unrecorded_visits');
    expect(json).not.toHaveProperty('unsent_reports');
    expect(json).not.toHaveProperty('overdue_tasks');
  });

  it('remains compatible with direct calls that omit routeContext', async () => {
    const response = await rawGET(createRequest({ 'x-org-id': 'org_1' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(withRoutePerformanceMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.any(Function),
    );
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(authContext, expect.any(Function));
    expectSensitiveNoStore(response);
  });

  it('keeps directly assigned task scope when a scoped user has no assigned patients or cases', async () => {
    careCaseFindManyMock.mockResolvedValue([]);
    visitScheduleCountMock.mockResolvedValue(0);
    careReportCountMock.mockResolvedValue(0);
    taskCountMock.mockResolvedValue(0);

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(visitScheduleCountMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          case_id: { in: [] },
        }),
      }),
    );
    expect(careReportCountMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patient_id: { in: [] },
        }),
      }),
    );
    expect(taskCountMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            {
              OR: [{ assigned_to: 'user_1' }],
            },
          ]),
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      summary: {
        unrecorded_visits: 0,
        unsent_reports: 0,
        overdue_tasks: 0,
        total: 0,
      },
    });
  });

  it('returns a sanitized no-store 500 when overdue reads fail', async () => {
    const unsafeError = new Error(
      'raw-overdue raw-patient raw-dashboard raw-SQL raw-stack raw-error text must not leak',
    );
    unsafeError.name =
      'crafted-name.raw-overdue.raw-patient.raw-dashboard.raw-SQL.raw-stack.raw-error';
    careCaseFindManyMock.mockRejectedValueOnce(unsafeError);

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expect(withRoutePerformanceMock).toHaveBeenCalledTimes(1);
    expectSensitiveNoStore(response);
    const body = await response.text();
    expect(body).toContain('INTERNAL_ERROR');
    expect(body).not.toContain('raw-overdue');
    expect(body).not.toContain('raw-patient');
    expect(body).not.toContain('raw-dashboard');
    expect(body).not.toContain('raw-SQL');
    expect(body).not.toContain('raw-stack');
    expect(body).not.toContain('crafted-name');
    expect(body).not.toContain('raw-error');
    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    expect(loggerErrorMock).toHaveBeenCalledWith('dashboard_overdue_unhandled_error', undefined, {
      event: 'dashboard_overdue_unhandled_error',
      route: '/api/dashboard/overdue',
      method: 'GET',
      status: 500,
      error_name: 'Error',
    });
    expect(loggerErrorMock.mock.calls[0]?.[1]).toBeUndefined();
    expect(loggerErrorMock.mock.calls[0]).not.toContain(unsafeError);
    const logged = JSON.stringify(loggerErrorMock.mock.calls);
    expect(logged).not.toContain('raw-overdue');
    expect(logged).not.toContain('raw-patient');
    expect(logged).not.toContain('raw-dashboard');
    expect(logged).not.toContain('raw-SQL');
    expect(logged).not.toContain('raw-stack');
    expect(logged).not.toContain('crafted-name');
    expect(logged).not.toContain('raw-error');
  });
});
