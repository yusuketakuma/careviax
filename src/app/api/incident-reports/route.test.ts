import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  loggerErrorMock,
  requireAuthContextMock,
  runWithRequestAuthContextMock,
  withRoutePerformanceMock,
  listIncidentReportsMock,
  createIncidentReportMock,
} = vi.hoisted(() => ({
  loggerErrorMock: vi.fn(),
  requireAuthContextMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn((_ctx, callback: () => unknown) => callback()),
  withRoutePerformanceMock: vi.fn((_req, callback: () => unknown) => callback()),
  listIncidentReportsMock: vi.fn(),
  createIncidentReportMock: vi.fn(),
}));

const authContext = {
  orgId: 'org_1',
  userId: 'user_1',
  role: 'pharmacist' as const,
  ipAddress: '127.0.0.1',
  userAgent: 'vitest',
};

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/auth/request-context', () => ({
  runWithRequestAuthContext: runWithRequestAuthContextMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

vi.mock('@/lib/utils/performance', () => ({
  withRoutePerformance: withRoutePerformanceMock,
}));

vi.mock('@/server/services/incident-reports', () => ({
  listIncidentReports: listIncidentReportsMock,
  createIncidentReport: createIncidentReportMock,
}));

import { GET, POST } from './route';

const routeCtx = { params: Promise.resolve({}) };

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

function makePostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/incident-reports', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/incident-reports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({ ctx: authContext });
    runWithRequestAuthContextMock.mockImplementation((_ctx, callback) => callback());
    withRoutePerformanceMock.mockImplementation((_req, callback) => callback());
    listIncidentReportsMock.mockResolvedValue([]);
    createIncidentReportMock.mockResolvedValue({
      id: 'incident_1',
      title: 'セット日付間違い',
      status: 'open',
    });
  });

  it('lists reports with optional status filter', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/incident-reports?status=reviewed'),
      routeCtx,
    );

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(withRoutePerformanceMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.any(Function),
    );
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canViewDashboard',
      message: 'ヒヤリハット記録の閲覧権限がありません',
    });
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(authContext, expect.any(Function));
    expect(listIncidentReportsMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_1' }),
      'reviewed',
    );
  });

  it('rejects unknown status filters before service access', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/incident-reports?status=unknown'),
      routeCtx,
    );

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(listIncidentReportsMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when incident report listing fails unexpectedly', async () => {
    const unsafeError = new Error('raw incident report medication safety narrative secret');
    unsafeError.name = 'crafted.incident.medication.safety.narrative.secret';
    listIncidentReportsMock.mockRejectedValueOnce(unsafeError);

    const response = await GET(new NextRequest('http://localhost/api/incident-reports'), routeCtx);

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
    });
    expect(JSON.stringify(body)).not.toContain('safety narrative secret');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'incident_reports_get_unhandled_error',
        route: '/api/incident-reports',
        method: 'GET',
        status: 500,
      },
      unsafeError,
    );
    expect(loggerErrorMock.mock.calls[0]?.[0]).not.toHaveProperty('error_name');
    const loggedContext = JSON.stringify(loggerErrorMock.mock.calls[0]?.[0]);
    expect(loggedContext).not.toContain('safety narrative secret');
    expect(loggedContext).not.toContain('crafted.incident');
  });

  it('creates a report after request validation', async () => {
    const response = await POST(
      makePostRequest({
        title: 'セット日付間違い',
        what_happened: '土曜セットに金曜の薬を入れた',
        related_process: 'set',
      }),
      routeCtx,
    );

    expect(response.status).toBe(201);
    expectNoStore(response);
    expect(withRoutePerformanceMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.any(Function),
    );
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canViewDashboard',
      message: 'ヒヤリハット記録の作成権限がありません',
    });
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(authContext, expect.any(Function));
    expect(createIncidentReportMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        title: 'セット日付間違い',
        what_happened: '土曜セットに金曜の薬を入れた',
        related_process: 'set',
      }),
    );
  });

  it('rejects invalid create payloads before service access', async () => {
    const response = await POST(
      makePostRequest({ title: '', related_process: 'unknown' }),
      routeCtx,
    );

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(createIncidentReportMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 without raw logging when incident report creation fails', async () => {
    const unsafeError = new Error('raw incident report patient safety create secret');
    unsafeError.name = 'crafted.incident.patient.safety.create.secret';
    createIncidentReportMock.mockRejectedValueOnce(unsafeError);

    const response = await POST(
      makePostRequest({
        title: 'セット日付間違い',
        what_happened: '土曜セットに金曜の薬を入れた',
        related_process: 'set',
      }),
      routeCtx,
    );

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
    });
    expect(JSON.stringify(body)).not.toContain('patient safety create secret');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'incident_reports_post_unhandled_error',
        route: '/api/incident-reports',
        method: 'POST',
        status: 500,
      },
      unsafeError,
    );
    expect(loggerErrorMock.mock.calls[0]?.[0]).not.toHaveProperty('error_name');
    const loggedContext = JSON.stringify(loggerErrorMock.mock.calls[0]?.[0]);
    expect(loggedContext).not.toContain('patient safety create secret');
    expect(loggedContext).not.toContain('crafted.incident');
  });
});
