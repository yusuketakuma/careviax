import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  authContext,
  requireAuthContextMock,
  runWithRequestAuthContextMock,
  loggerErrorMock,
  withRoutePerformanceMock,
  patientFindManyMock,
  visitRecordGroupByMock,
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
    patientFindManyMock: vi.fn(),
    visitRecordGroupByMock: vi.fn(),
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
    patient: {
      findMany: patientFindManyMock,
    },
    visitRecord: {
      groupBy: visitRecordGroupByMock,
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

function createRequest(url: string, headers?: Record<string, string>) {
  return new NextRequest(url, {
    headers,
  });
}

describe('/api/dashboard/monthly-stats GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({ ctx: authContext });
    runWithRequestAuthContextMock.mockImplementation((_ctx, callback) => callback());
    withRoutePerformanceMock.mockImplementation((_req, handler) => handler());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns validation error for invalid month format', async () => {
    const response = await GET(
      createRequest('http://localhost/api/dashboard/monthly-stats?month=2026/03', {
        'x-org-id': 'org_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canViewDashboard',
      message: 'ダッシュボードの閲覧権限がありません',
    });
    expect(visitRecordGroupByMock).not.toHaveBeenCalled();
  });

  it('rejects out-of-range month values', async () => {
    const response = await GET(
      createRequest('http://localhost/api/dashboard/monthly-stats?month=2026-13', {
        'x-org-id': 'org_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(visitRecordGroupByMock).not.toHaveBeenCalled();
  });

  it.each([
    ['blank month', 'http://localhost/api/dashboard/monthly-stats?month='],
    ['padded month', 'http://localhost/api/dashboard/monthly-stats?month=%202026-03%20'],
  ])('rejects %s before querying monthly visit stats', async (_label, url) => {
    const response = await GET(createRequest(url, { 'x-org-id': 'org_1' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'month の形式が不正です（YYYY-MM）',
    });
    expect(visitRecordGroupByMock).not.toHaveBeenCalled();
  });

  it('rejects duplicate month params before querying monthly visit stats', async () => {
    const response = await GET(
      createRequest('http://localhost/api/dashboard/monthly-stats?month=2026-03&month=2026-04', {
        'x-org-id': 'org_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'month の形式が不正です（YYYY-MM）',
      details: {
        month: ['month は1つだけ指定してください'],
      },
    });
    expect(visitRecordGroupByMock).not.toHaveBeenCalled();
  });

  it('defaults to the current month when month is omitted', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-15T03:00:00.000Z')); // 2026-04-15 12:00 JST
    visitRecordGroupByMock.mockResolvedValue([]);

    const response = await GET(
      createRequest('http://localhost/api/dashboard/monthly-stats', { 'x-org-id': 'org_1' }),
    );

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
    expect(visitRecordGroupByMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          visit_date: {
            gte: new Date('2026-03-31T15:00:00.000Z'),
            lt: new Date('2026-04-30T15:00:00.000Z'),
          },
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      month: '2026-04',
      summary: { total_patients: 0 },
      patient_stats: [],
    });
  });

  it('defaults to the Japan business month even when the UTC date is still the previous month', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-30T15:30:00.000Z')); // 2026-07-01 00:30 JST
    visitRecordGroupByMock.mockResolvedValue([]);

    const response = await GET(
      createRequest('http://localhost/api/dashboard/monthly-stats', { 'x-org-id': 'org_1' }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(visitRecordGroupByMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          visit_date: {
            gte: new Date('2026-06-30T15:00:00.000Z'),
            lt: new Date('2026-07-31T15:00:00.000Z'),
          },
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      month: '2026-07',
      summary: { total_patients: 0 },
      patient_stats: [],
    });
  });

  it('returns grouped monthly patient stats', async () => {
    visitRecordGroupByMock.mockResolvedValue([
      {
        patient_id: 'patient_1',
        _count: { _all: 2 },
      },
      {
        patient_id: 'patient_2',
        _count: { _all: 3 },
      },
    ]);
    patientFindManyMock.mockResolvedValue([
      {
        id: 'patient_1',
        name: '山田 太郎',
        medical_insurance_number: 'M001',
        care_insurance_number: null,
      },
      {
        id: 'patient_2',
        name: '佐藤 花子',
        medical_insurance_number: null,
        care_insurance_number: 'C002',
      },
    ]);

    const response = await GET(
      createRequest('http://localhost/api/dashboard/monthly-stats?month=2026-03', {
        'x-org-id': 'org_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(visitRecordGroupByMock).toHaveBeenCalledWith({
      by: ['patient_id'],
      where: {
        org_id: 'org_1',
        visit_date: {
          gte: new Date('2026-02-28T15:00:00.000Z'),
          lt: new Date('2026-03-31T15:00:00.000Z'),
        },
        outcome_status: {
          in: ['completed', 'completed_with_issue', 'delivery_only', 'revisit_needed'],
        },
      },
      _count: {
        _all: true,
      },
    });
    expect(patientFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        id: { in: ['patient_1', 'patient_2'] },
      },
      select: {
        id: true,
        name: true,
        medical_insurance_number: true,
        care_insurance_number: true,
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      month: '2026-03',
      summary: {
        total_patients: 2,
        over_limit_count: 1,
        under_limit_count: 1,
      },
      patient_stats: [
        expect.objectContaining({
          patient_id: 'patient_2',
          insurance_basis: 'care',
          visit_count: 3,
          monthly_limit: 2,
          status: 'over_limit',
        }),
        expect.objectContaining({
          patient_id: 'patient_1',
          insurance_basis: 'medical',
          visit_count: 2,
          monthly_limit: 4,
          status: 'under_limit',
        }),
      ],
    });
  });

  it('wraps auth failure responses in no-store headers before any monthly stats lookup', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: NextResponse.json({ code: 'AUTH_FORBIDDEN' }, { status: 403 }),
    });

    const response = await GET(
      createRequest('http://localhost/api/dashboard/monthly-stats?month=2026-03', {
        'x-org-id': 'org_1',
      }),
    );

    expect(response.status).toBe(403);
    expect(withRoutePerformanceMock).toHaveBeenCalledTimes(1);
    expectSensitiveNoStore(response);
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(visitRecordGroupByMock).not.toHaveBeenCalled();
    expect(patientFindManyMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it('returns a no-store fixed error without leaking raw monthly stats failures', async () => {
    const leakyError = new Error(
      'patient 山田太郎 insurance_number SELECT * FROM Patient stack trace',
    );
    leakyError.name = 'PatientLeakError:山田:insurance:SQL';
    visitRecordGroupByMock.mockRejectedValueOnce(leakyError);

    const response = await GET(
      createRequest('http://localhost/api/dashboard/monthly-stats?month=2026-03', {
        'x-org-id': 'org_1',
      }),
    );

    expect(response.status).toBe(500);
    expect(withRoutePerformanceMock).toHaveBeenCalledTimes(1);
    expectSensitiveNoStore(response);
    const body = await response.text();
    expect(body).toContain('INTERNAL_ERROR');
    expect(body).not.toContain('patient 山田太郎');
    expect(body).not.toContain('insurance_number');
    expect(body).not.toContain('SELECT');
    expect(body).not.toContain('stack trace');
    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'dashboard_monthly_stats_unhandled_error',
        route: '/api/dashboard/monthly-stats',
        method: 'GET',
        status: 500,
      },
      leakyError,
    );
    expect(loggerErrorMock.mock.calls[0]?.[0]).not.toHaveProperty('error_name');
    const loggedContext = JSON.stringify(loggerErrorMock.mock.calls[0]?.[0]);
    expect(loggedContext).not.toContain('PatientLeakError');
    expect(loggedContext).not.toContain('山田太郎');
    expect(loggedContext).not.toContain('insurance_number');
    expect(loggedContext).not.toContain('SELECT');
    expect(loggedContext).not.toContain('stack');
  });
});
