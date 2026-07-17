import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';
import {
  buildIncidentReportResponseSchema,
  incidentReportsResponseSchema,
} from '@/lib/incident-reports/response-schema';

const {
  authMock,
  membershipFindFirstMock,
  prismaMock,
  securityEventExecuteRawMock,
  auditLogCreateMock,
  loggerErrorMock,
  runWithRequestAuthContextMock,
  unstableRethrowMock,
  listIncidentReportsMock,
  createIncidentReportMock,
} = vi.hoisted(() => {
  const membershipFindFirstMock = vi.fn();
  const securityEventExecuteRawMock = vi.fn();
  const auditLogCreateMock = vi.fn();
  const prismaMock = {
    membership: { findFirst: membershipFindFirstMock },
    auditLog: { create: auditLogCreateMock },
    $transaction: vi.fn(
      (
        fn: (tx: {
          $executeRaw: typeof securityEventExecuteRawMock;
          auditLog: { create: typeof auditLogCreateMock };
        }) => unknown,
      ) =>
        fn({
          $executeRaw: securityEventExecuteRawMock,
          auditLog: { create: auditLogCreateMock },
        }),
    ),
  };
  return {
    authMock: vi.fn(),
    membershipFindFirstMock,
    prismaMock,
    securityEventExecuteRawMock,
    auditLogCreateMock,
    loggerErrorMock: vi.fn(),
    runWithRequestAuthContextMock: vi.fn((_ctx, callback: () => unknown) => callback()),
    unstableRethrowMock: vi.fn(),
    listIncidentReportsMock: vi.fn(),
    createIncidentReportMock: vi.fn(),
  };
});

vi.mock('next/navigation', () => ({ unstable_rethrow: unstableRethrowMock }));

vi.mock('@/lib/auth/config', () => ({ auth: authMock }));

vi.mock('@/lib/db/client', () => ({ prisma: prismaMock }));

vi.mock('@/lib/auth/request-context', () => ({
  clearRequestAuthContext: vi.fn(),
  runWithRequestAuthContext: runWithRequestAuthContextMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

vi.mock('@/server/services/incident-reports', () => ({
  listIncidentReports: listIncidentReportsMock,
  createIncidentReport: createIncidentReportMock,
}));

import { GET, POST } from './route';
import { __resetSecurityEventDedupForTest } from '@/lib/auth/security-events';

const routeCtx = { params: Promise.resolve({}) };

function makeGetRequest(url = 'http://localhost/api/incident-reports') {
  return new NextRequest(url, { headers: { 'x-org-id': 'org_1' } });
}

function makePostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/incident-reports', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-org-id': 'org_1' },
    body: JSON.stringify(body),
  });
}

function makeMalformedPostRequest() {
  return new NextRequest('http://localhost/api/incident-reports', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-org-id': 'org_1' },
    body: '{',
  });
}

const incidentReport = {
  id: 'incident_1',
  title: 'セット日付間違い',
  what_happened: '土曜セットに金曜の薬を入れた',
  cause: null,
  immediate_action: null,
  prevention_plan: null,
  related_process: 'set',
  severity: 'near_miss',
  status: 'open',
  occurred_at: null,
  reported_by: 'user_1',
  created_at: new Date('2026-07-17T00:00:00.000Z'),
  updated_at: new Date('2026-07-17T00:00:00.000Z'),
};

describe('/api/incident-reports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetSecurityEventDedupForTest();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist', site_id: null });
    securityEventExecuteRawMock.mockResolvedValue(0);
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    listIncidentReportsMock.mockResolvedValue([incidentReport]);
    createIncidentReportMock.mockResolvedValue(incidentReport);
  });

  it('lists reports with optional status filter', async () => {
    const response = await GET(
      makeGetRequest('http://localhost/api/incident-reports?status=reviewed'),
      routeCtx,
    );

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(runWithRequestAuthContextMock).toHaveBeenCalledOnce();
    expect(listIncidentReportsMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_1' }),
      'reviewed',
    );
    expect(incidentReportsResponseSchema.safeParse(await response.json()).success).toBe(true);
  });

  it('rejects unknown status filters before service access', async () => {
    const response = await GET(
      makeGetRequest('http://localhost/api/incident-reports?status=unknown'),
      routeCtx,
    );

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(listIncidentReportsMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it.each([
    ['open', 'open'],
    ['closed', 'closed'],
    ['', undefined],
  ] as const)('preserves optional status filter %s', async (status, expected) => {
    const response = await GET(
      makeGetRequest(`http://localhost/api/incident-reports?status=${status}`),
      routeCtx,
    );

    expect(response.status).toBe(200);
    expect(listIncidentReportsMock).toHaveBeenCalledWith(expect.any(Object), expected);
  });

  it('returns 401 before status parsing or POST body consumption', async () => {
    authMock.mockResolvedValue(null);
    const postRequest = makeMalformedPostRequest();

    const getResponse = await GET(
      makeGetRequest('http://localhost/api/incident-reports?status=unknown'),
      routeCtx,
    );
    const postResponse = await POST(postRequest, routeCtx);

    expect(getResponse.status).toBe(401);
    expect(postResponse.status).toBe(401);
    expectNoStore(getResponse);
    expectNoStore(postResponse);
    expect(postRequest.bodyUsed).toBe(false);
    expect(listIncidentReportsMock).not.toHaveBeenCalled();
    expect(createIncidentReportMock).not.toHaveBeenCalled();
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
  });

  it('returns distinct GET and POST 403 messages and persists security audits', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'driver', site_id: null });

    const getResponse = await GET(makeGetRequest(), routeCtx);
    expect(getResponse.status).toBe(403);
    await expect(getResponse.json()).resolves.toMatchObject({
      message: 'ヒヤリハット記録の閲覧権限がありません',
    });
    await vi.waitFor(() => expect(auditLogCreateMock).toHaveBeenCalledOnce());
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'security:unauthorized_access',
      }),
    });

    __resetSecurityEventDedupForTest();
    auditLogCreateMock.mockClear();
    const postRequest = makeMalformedPostRequest();
    const postResponse = await POST(postRequest, routeCtx);
    expect(postResponse.status).toBe(403);
    expect(postRequest.bodyUsed).toBe(false);
    await expect(postResponse.json()).resolves.toMatchObject({
      message: 'ヒヤリハット記録の作成権限がありません',
    });
    await vi.waitFor(() => expect(auditLogCreateMock).toHaveBeenCalledOnce());
    expect(listIncidentReportsMock).not.toHaveBeenCalled();
    expect(createIncidentReportMock).not.toHaveBeenCalled();
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(
      loggerErrorMock.mock.calls.some(
        ([context]) => context?.event === 'security_event.audit_log_persist_failed',
      ),
    ).toBe(false);
  });

  it('returns a traced safe auth 500 before service or body work', async () => {
    const unsafeError = new Error('raw incident auth secret');
    unsafeError.name = 'IncidentAuthSecretError';
    authMock.mockRejectedValue(unsafeError);
    const postRequest = makeMalformedPostRequest();

    const response = await POST(postRequest, routeCtx);
    const body = await response.json();

    expect(response.status).toBe(500);
    expectNoStore(response);
    expect(postRequest.bodyUsed).toBe(false);
    expect(createIncidentReportMock).not.toHaveBeenCalled();
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toMatch(/incident auth secret|IncidentAuthSecretError/);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_auth_unhandled_error',
        route: '/api/incident-reports',
        method: 'POST',
        requestId: response.headers.get('X-Request-Id'),
        correlationId: response.headers.get('X-Correlation-Id'),
      },
      unsafeError,
    );
  });

  it('returns a sanitized no-store 500 when incident report listing fails unexpectedly', async () => {
    const unsafeError = new Error('raw incident report medication safety narrative secret');
    unsafeError.name = 'crafted.incident.medication.safety.narrative.secret';
    listIncidentReportsMock.mockRejectedValueOnce(unsafeError);

    const response = await GET(makeGetRequest(), routeCtx);

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
    });
    expect(JSON.stringify(body)).not.toContain('safety narrative secret');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_handler_unhandled_error',
        route: '/api/incident-reports',
        method: 'GET',
        requestId: response.headers.get('X-Request-Id'),
        correlationId: response.headers.get('X-Correlation-Id'),
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
    expect(runWithRequestAuthContextMock).toHaveBeenCalledOnce();
    expect(createIncidentReportMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        title: 'セット日付間違い',
        what_happened: '土曜セットに金曜の薬を入れた',
        related_process: 'set',
      }),
    );
    expect(
      buildIncidentReportResponseSchema('incident_1').safeParse(await response.json()).success,
    ).toBe(true);
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

  it.each([
    ['malformed JSON', () => makeMalformedPostRequest()],
    ['non-object JSON', () => makePostRequest([])],
  ])('rejects %s after authorization and before service access', async (_label, requestFactory) => {
    const response = await POST(requestFactory(), routeCtx);

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(createIncidentReportMock).not.toHaveBeenCalled();
    expect(runWithRequestAuthContextMock).toHaveBeenCalledOnce();
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
        event: 'route_handler_unhandled_error',
        route: '/api/incident-reports',
        method: 'POST',
        requestId: response.headers.get('X-Request-Id'),
        correlationId: response.headers.get('X-Correlation-Id'),
      },
      unsafeError,
    );
    expect(loggerErrorMock.mock.calls[0]?.[0]).not.toHaveProperty('error_name');
    const loggedContext = JSON.stringify(loggerErrorMock.mock.calls[0]?.[0]);
    expect(loggedContext).not.toContain('patient safety create secret');
    expect(loggedContext).not.toContain('crafted.incident');
  });

  it('rethrows auth and handler control flow without logging or service work', async () => {
    const authControl = new Error('NEXT_REDIRECT');
    authMock.mockRejectedValueOnce(authControl);
    unstableRethrowMock.mockImplementationOnce((error) => {
      throw error;
    });

    await expect(GET(makeGetRequest(), routeCtx)).rejects.toBe(authControl);
    expect(listIncidentReportsMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).not.toHaveBeenCalled();

    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist', site_id: null });
    const handlerControl = new Error('NEXT_NOT_FOUND');
    createIncidentReportMock.mockRejectedValueOnce(handlerControl);
    unstableRethrowMock.mockImplementationOnce((error) => {
      throw error;
    });

    await expect(
      POST(
        makePostRequest({
          title: 'セット日付間違い',
          what_happened: '土曜セットに金曜の薬を入れた',
          related_process: 'set',
        }),
        routeCtx,
      ),
    ).rejects.toBe(handlerControl);
    expect(runWithRequestAuthContextMock).toHaveBeenCalledOnce();
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });
});
