import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getPerformanceSnapshot, resetPerformanceMetrics } from '@/lib/utils/performance';

const {
  authContextMock,
  authRejectionMock,
  withAuthContextOptions,
  createScopedTxRunnerMock,
  fakeRunner,
  getPatientMedicationStockSummaryMock,
  recordPhiReadAuditForRequestMock,
  loggerErrorMock,
} = vi.hoisted(() => {
  const runner = vi.fn((work: (tx: unknown) => unknown) => work({ tx: true }));
  return {
    authContextMock: vi.fn(),
    authRejectionMock: vi.fn<() => Response | null>(() => null),
    withAuthContextOptions: [] as Array<{ permission?: string; message?: string }>,
    createScopedTxRunnerMock: vi.fn(() => runner),
    fakeRunner: runner,
    getPatientMedicationStockSummaryMock: vi.fn(),
    recordPhiReadAuditForRequestMock: vi.fn(),
    loggerErrorMock: vi.fn(),
  };
});

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (...args: unknown[]) => Promise<Response>,
    options?: { permission?: string; message?: string },
  ) => {
    withAuthContextOptions.push(options ?? {});
    return (req: Request, routeContext: { params: Promise<{ id: string }> }) => {
      const rejection = authRejectionMock();
      if (rejection) return Promise.resolve(rejection);
      return handler(req, authContextMock(), routeContext);
    };
  },
}));

vi.mock('@/lib/db/rls', () => ({
  createScopedTxRunner: createScopedTxRunnerMock,
}));

vi.mock('@/lib/audit/phi-read-audit', () => ({
  recordPhiReadAuditForRequest: recordPhiReadAuditForRequestMock,
}));

vi.mock('@/modules/pharmacy', () => ({
  getPatientMedicationStockSummary: getPatientMedicationStockSummaryMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock },
}));

import { GET } from './route';

const jsonPayloadBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

const authContext = {
  orgId: 'org_1',
  role: 'pharmacist' as const,
  userId: 'user_1',
  actorSiteId: 'site_1',
  ipAddress: '203.0.113.10',
  userAgent: 'vitest',
  requestId: 'req_patient_medication_stock_1',
  correlationId: 'corr_patient_medication_stock_1',
};

function createRequest(url = 'http://localhost/api/patients/patient_1/medication-stock') {
  return new NextRequest(url);
}

describe('GET /api/patients/[id]/medication-stock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPerformanceMetrics();
    authContextMock.mockReturnValue(authContext);
    authRejectionMock.mockReturnValue(null);
    createScopedTxRunnerMock.mockReturnValue(fakeRunner);
    fakeRunner.mockImplementation((work: (tx: unknown) => unknown) => work({ tx: true }));
  });

  it('returns the medication stock summary through an org-scoped runner with no-store headers', async () => {
    getPatientMedicationStockSummaryMock.mockResolvedValue({
      data: {
        patient_id: 'patient_1',
        summary: {
          visible_item_count: 1,
        },
        items: [],
        recent_events: [{ id: 'event_1' }],
      },
      meta: {
        generated_at: '2026-07-07T00:00:00.000Z',
        item_limit: 50,
        event_limit: 12,
        visible_count: 1,
        hidden_count: 0,
        count_basis: 'limited_items',
        partial_failures: [],
      },
    });

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    const payload = await response.json();
    expect(Object.keys(payload).sort()).toEqual(['data', 'meta']);
    const responseBytes = jsonPayloadBytes(payload);
    expect(response.headers.get('Content-Length')).toBe(String(responseBytes));
    expect(
      getPerformanceSnapshot({ topRoutes: 100 }).routes.find(
        (route) => route.method === 'GET' && route.route === '/api/patients/:id/medication-stock',
      ),
    ).toMatchObject({
      critical_route: true,
      critical_route_family: 'patient-medication-stock-summary',
      payload_sample_count: 1,
      last_payload_bytes: responseBytes,
      payload_budget_bytes: 256_000,
      payload_budget_status: 'within_budget',
      payload_budget_met: true,
    });
    expect(payload.meta).toMatchObject({
      generated_at: '2026-07-07T00:00:00.000Z',
      item_limit: 50,
      event_limit: 12,
      visible_count: 1,
      hidden_count: 0,
      count_basis: 'limited_items',
      partial_failures: [],
    });
    expect(withAuthContextOptions).toContainEqual({
      permission: 'canVisit',
      message: '患者の残数管理情報の閲覧権限がありません',
    });
    expect(createScopedTxRunnerMock).toHaveBeenCalledWith('org_1', {
      requestContext: authContext,
    });
    expect(getPatientMedicationStockSummaryMock).toHaveBeenCalledWith(
      { tx: true },
      {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'user_1',
        itemLimit: 50,
        eventLimit: 12,
      },
    );
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      {
        patientId: 'patient_1',
        view: 'patient_medication_stock',
        purpose: 'care',
        metadata: {
          visible_item_count: 1,
          recent_event_count: 1,
        },
      },
    );
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it('passes bounded item and event limits to the summary service', async () => {
    getPatientMedicationStockSummaryMock.mockResolvedValue({
      data: {
        patient_id: 'patient_1',
        summary: { visible_item_count: 0 },
        items: [],
        recent_events: [],
      },
      meta: {
        generated_at: '2026-07-07T00:00:00.000Z',
        item_limit: 5,
        event_limit: 0,
        visible_count: 0,
        hidden_count: 0,
        count_basis: 'limited_items',
        partial_failures: [],
      },
    });

    const response = await GET(
      createRequest(
        'http://localhost/api/patients/patient_1/medication-stock?item_limit=5&event_limit=0',
      ),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );

    expect(response.status).toBe(200);
    expect(getPatientMedicationStockSummaryMock).toHaveBeenCalledWith(
      { tx: true },
      expect.objectContaining({
        itemLimit: 5,
        eventLimit: 0,
      }),
    );
  });

  it('rejects invalid limits before building the scoped runner', async () => {
    const response = await GET(
      createRequest('http://localhost/api/patients/patient_1/medication-stock?item_limit=101'),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );

    expect(response.status).toBe(400);
    expect(createScopedTxRunnerMock).not.toHaveBeenCalled();
    expect(getPatientMedicationStockSummaryMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it('rejects blank patient ids before DB reads', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: '   ' }),
    });

    expect(response.status).toBe(400);
    expect(createScopedTxRunnerMock).not.toHaveBeenCalled();
    expect(getPatientMedicationStockSummaryMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it('returns authorization rejection without building a scoped runner, audit, or error log', async () => {
    authRejectionMock.mockReturnValueOnce(
      Response.json({ code: 'AUTH_FORBIDDEN', message: '権限がありません' }, { status: 403 }),
    );

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    expect(response.status).toBe(403);
    expect(createScopedTxRunnerMock).not.toHaveBeenCalled();
    expect(getPatientMedicationStockSummaryMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it('returns 404 without PHI audit when the patient is not visible', async () => {
    getPatientMedicationStockSummaryMock.mockResolvedValue(null);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    expect(response.status).toBe(404);
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it('returns a no-store internal error without PHI audit when the summary read fails', async () => {
    const rawError = '患者A ワルファリン medication stock provider failure';
    getPatientMedicationStockSummaryMock.mockRejectedValueOnce(new Error(rawError));

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(JSON.stringify(payload)).not.toContain(rawError);
    expect(JSON.stringify(payload)).not.toContain('患者A');
    expect(JSON.stringify(payload)).not.toContain('ワルファリン');
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    expect(loggerErrorMock).toHaveBeenCalledWith({
      event: 'patient_medication_stock_get_unhandled_error',
      route: '/api/patients/[id]/medication-stock',
      method: 'GET',
      status: 500,
      code: 'PATIENT_MEDICATION_STOCK_READ_FAILED',
      request_id: 'req_patient_medication_stock_1',
    });
    expect(loggerErrorMock.mock.calls[0]).toHaveLength(1);
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain(rawError);
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('患者A');
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('ワルファリン');
  });

  it('uses the same coded PHI-safe log when scoped runner setup fails', async () => {
    const rawError = '患者B モルヒネ RLS runner setup failure';
    createScopedTxRunnerMock.mockImplementationOnce(() => {
      throw new Error(rawError);
    });

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(JSON.stringify(payload)).not.toContain(rawError);
    expect(getPatientMedicationStockSummaryMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'PATIENT_MEDICATION_STOCK_READ_FAILED',
        request_id: 'req_patient_medication_stock_1',
      }),
    );
    expect(loggerErrorMock.mock.calls[0]).toHaveLength(1);
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain(rawError);
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('患者B');
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('モルヒネ');
  });
});
