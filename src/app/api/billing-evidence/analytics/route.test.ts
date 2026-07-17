import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  authContext,
  requireAuthContextMock,
  runWithRequestAuthContextMock,
  loggerErrorMock,
  withRoutePerformanceMock,
  billingCandidateFindManyMock,
  billingCandidateGroupByMock,
  billingEvidenceFindManyMock,
  billingEvidenceGroupByMock,
  billingRuleCountMock,
} = vi.hoisted(() => ({
  authContext: {
    orgId: 'org_1',
    userId: 'report_1',
    role: 'manager',
    requestId: 'request_1',
    correlationId: 'correlation_1',
  },
  requireAuthContextMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn((_ctx, callback) => callback()),
  loggerErrorMock: vi.fn(),
  withRoutePerformanceMock: vi.fn((_req, handler) => handler()),
  billingCandidateFindManyMock: vi.fn(),
  billingCandidateGroupByMock: vi.fn(),
  billingEvidenceFindManyMock: vi.fn(),
  billingEvidenceGroupByMock: vi.fn(),
  billingRuleCountMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
  withAuthContext:
    (
      handler: (
        req: NextRequest,
        ctx: typeof authContext,
        routeContext: { params: Promise<Record<string, string>> },
      ) => Promise<Response>,
      options: unknown,
    ) =>
    async (req: NextRequest, routeContext: { params: Promise<Record<string, string>> }) =>
      withRoutePerformanceMock(req, async () => {
        let response: Response;
        let trace = authContext;
        try {
          const authResult = await requireAuthContextMock(req, options);
          if ('response' in authResult) {
            response = authResult.response;
          } else {
            trace = authResult.ctx;
            try {
              response = await runWithRequestAuthContextMock(authResult.ctx, () =>
                handler(req, authResult.ctx, routeContext),
              );
            } catch (error) {
              loggerErrorMock(
                {
                  event: 'route_handler_unhandled_error',
                  route: req.nextUrl.pathname,
                  method: req.method,
                  requestId: authResult.ctx.requestId,
                  correlationId: authResult.ctx.correlationId,
                },
                error,
              );
              response = NextResponse.json(
                { code: 'INTERNAL_ERROR', message: 'サーバー内部でエラーが発生しました' },
                { status: 500 },
              );
            }
          }
        } catch (error) {
          trace = {
            ...authContext,
            requestId: 'generated_request_1',
            correlationId: req.headers.get('x-correlation-id') ?? 'generated_request_1',
          };
          loggerErrorMock(
            {
              event: 'route_auth_unhandled_error',
              route: req.nextUrl.pathname,
              method: req.method,
              requestId: trace.requestId,
              correlationId: trace.correlationId,
            },
            error,
          );
          response = NextResponse.json(
            { code: 'INTERNAL_ERROR', message: 'サーバー内部でエラーが発生しました' },
            { status: 500 },
          );
        }
        response.headers.set('Cache-Control', 'private, no-store, max-age=0');
        response.headers.set('Pragma', 'no-cache');
        response.headers.set('X-Request-Id', trace.requestId);
        response.headers.set('X-Correlation-Id', trace.correlationId);
        return response;
      }),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    billingCandidate: {
      findMany: billingCandidateFindManyMock,
      groupBy: billingCandidateGroupByMock,
    },
    billingEvidence: {
      findMany: billingEvidenceFindManyMock,
      groupBy: billingEvidenceGroupByMock,
    },
    billingRule: {
      count: billingRuleCountMock,
    },
  },
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { GET } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };

function createRequest() {
  return new NextRequest('http://localhost/api/billing-evidence/analytics', {
    headers: {
      'x-org-id': 'org_1',
      'x-request-id': 'request_1',
      'x-correlation-id': 'correlation_1',
    },
  });
}

describe('/api/billing-evidence/analytics GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-28T15:30:00.000Z'));
    requireAuthContextMock.mockResolvedValue({ ctx: authContext });
    runWithRequestAuthContextMock.mockImplementation((_ctx, callback) => callback());
    withRoutePerformanceMock.mockImplementation((_req, handler) => handler());
    billingRuleCountMock.mockResolvedValue(16);
    billingCandidateFindManyMock.mockResolvedValue([
      {
        billing_month: new Date('2026-03-01T00:00:00.000Z'),
        source_snapshot: { revision_code: '2026' },
      },
      {
        billing_month: new Date('2026-03-01T00:00:00.000Z'),
        source_snapshot: { revision_code: '2026' },
      },
      {
        billing_month: new Date('2026-03-01T00:00:00.000Z'),
        source_snapshot: { revision_code: '2024' },
      },
      {
        billing_month: new Date('2026-03-01T00:00:00.000Z'),
        source_snapshot: ['unexpected'],
      },
    ]);
    billingCandidateGroupByMock.mockImplementation(async (args: { by: string[] }) => {
      if (args.by.includes('status')) {
        return [
          {
            billing_month: new Date('2026-03-01T00:00:00.000Z'),
            status: 'candidate',
            _count: { id: 1 },
          },
          {
            billing_month: new Date('2026-03-01T00:00:00.000Z'),
            status: 'confirmed',
            _count: { id: 1 },
          },
          {
            billing_month: new Date('2026-03-01T00:00:00.000Z'),
            status: 'exported',
            _count: { id: 1 },
          },
          {
            billing_month: new Date('2026-03-01T00:00:00.000Z'),
            status: 'excluded',
            _count: { id: 1 },
          },
        ];
      }

      return [
        {
          billing_code: 'M001',
          billing_name: '在宅患者訪問薬剤管理指導料',
          _count: { id: 1 },
        },
        {
          billing_code: 'A010',
          billing_name: '麻薬加算',
          _count: { id: 1 },
        },
      ];
    });
    billingEvidenceFindManyMock.mockResolvedValue([
      {
        billing_month: new Date('2026-03-01T00:00:00.000Z'),
        calculation_context: {
          effective_revision_code: '2026',
          site_config_status: 'resolved',
        },
      },
      {
        billing_month: new Date('2026-03-01T00:00:00.000Z'),
        calculation_context: {
          effective_revision_code: '2024',
          site_config_status: 'revision_mismatch',
        },
      },
      {
        billing_month: new Date('2026-03-01T00:00:00.000Z'),
        calculation_context: ['unexpected'],
      },
    ]);
    billingEvidenceGroupByMock.mockImplementation(async (args: { by: string[] }) => {
      if (args.by.includes('claimable')) {
        return [
          {
            billing_month: new Date('2026-03-01T00:00:00.000Z'),
            claimable: true,
            _count: { id: 1 },
          },
          {
            billing_month: new Date('2026-03-01T00:00:00.000Z'),
            claimable: false,
            _count: { id: 2 },
          },
        ];
      }

      return [{ exclusion_reason: '報告書送付が未完了です', _count: { id: 1 } }];
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns monthly operational analytics', async () => {
    const response = await GET(createRequest(), emptyRouteContext);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(withRoutePerformanceMock).toHaveBeenCalledTimes(1);
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canReport',
      message: '請求分析の閲覧権限がありません',
    });
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(authContext, expect.any(Function));
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        summary: {
          ssot_rule_count: 16,
          current_month: '2026-03',
          current_month_candidates: expect.any(Number),
          current_month_review_pending: expect.any(Number),
          current_month_claimable_rate: expect.any(Number),
          current_month_close_rate: expect.any(Number),
          current_month_exported: expect.any(Number),
          current_month_revision_counts: {
            '2024': 2,
            '2026': 3,
            unknown: 2,
          },
          current_month_site_config_issue_count: 1,
        },
        blocker_reasons: expect.any(Array),
        top_codes: expect.any(Array),
        monthly_trend: [
          expect.objectContaining({ month: '2025-10' }),
          expect.objectContaining({ month: '2025-11' }),
          expect.objectContaining({ month: '2025-12' }),
          expect.objectContaining({ month: '2026-01' }),
          expect.objectContaining({ month: '2026-02' }),
          expect.objectContaining({ month: '2026-03' }),
        ],
      },
    });
    const rangeStart = new Date('2025-10-01T00:00:00.000Z');
    expect(billingCandidateFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          billing_month: {
            gte: rangeStart,
          },
        }),
      }),
    );
    expect(billingCandidateGroupByMock).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['billing_month', 'status'],
        _count: { id: true },
      }),
    );
    expect(billingCandidateGroupByMock).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['billing_code', 'billing_name'],
        take: 5,
      }),
    );
    expect(billingEvidenceFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          billing_month: {
            gte: rangeStart,
          },
        }),
      }),
    );
    expect(billingEvidenceGroupByMock).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['billing_month', 'claimable'],
        _count: { id: true },
      }),
    );
    expect(billingEvidenceGroupByMock).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['exclusion_reason'],
        take: 5,
      }),
    );
  });

  it('wraps auth failure responses in no-store headers before any billing lookup', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: NextResponse.json({ code: 'AUTH_FORBIDDEN' }, { status: 403 }),
    });

    const response = await GET(createRequest(), emptyRouteContext);

    expect(response.status).toBe(403);
    expect(withRoutePerformanceMock).toHaveBeenCalledTimes(1);
    expectSensitiveNoStore(response);
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(billingCandidateFindManyMock).not.toHaveBeenCalled();
    expect(billingCandidateGroupByMock).not.toHaveBeenCalled();
    expect(billingEvidenceFindManyMock).not.toHaveBeenCalled();
    expect(billingEvidenceGroupByMock).not.toHaveBeenCalled();
    expect(billingRuleCountMock).not.toHaveBeenCalled();
  });

  it('returns a no-store fixed error without leaking raw billing analytics failures', async () => {
    const thrownError = new Error(
      'patient 山田太郎 analytics failed with SQL select * from billing_evidence',
    );
    billingCandidateFindManyMock.mockRejectedValueOnce(thrownError);

    const response = await GET(createRequest(), emptyRouteContext);

    expect(response.status).toBe(500);
    expect(withRoutePerformanceMock).toHaveBeenCalledTimes(1);
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(authContext, expect.any(Function));
    expectSensitiveNoStore(response);
    const body = await response.text();
    expect(body).toContain('INTERNAL_ERROR');
    expect(body).not.toContain('patient 山田太郎');
    expect(body).not.toContain('SQL select');
    expect(body).not.toContain('billing_evidence');
    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_handler_unhandled_error',
        route: '/api/billing-evidence/analytics',
        method: 'GET',
        requestId: 'request_1',
        correlationId: 'correlation_1',
      },
      thrownError,
    );
    const [logContext, logError] = loggerErrorMock.mock.calls[0] ?? [];
    expect(logError).toBe(thrownError);
    expect(logContext).not.toHaveProperty('error_name');
    const logged = JSON.stringify(logContext);
    expect(logged).not.toContain('patient 山田太郎');
    expect(logged).not.toContain('SQL select');
    expect(logged).not.toContain('select * from');
    expect(logged).not.toContain('stack');
  });

  it('sanitizes unexpected error names with a strict allowlist', async () => {
    const thrownError = new Error('patient 山田太郎 should not leak');
    thrownError.name = 'PatientName山田太郎';
    billingCandidateFindManyMock.mockRejectedValueOnce(thrownError);

    const response = await GET(createRequest(), emptyRouteContext);

    expect(response.status).toBe(500);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'route_handler_unhandled_error' }),
      thrownError,
    );
    const [logContext, logError] = loggerErrorMock.mock.calls[0] ?? [];
    expect(logError).toBe(thrownError);
    expect(logContext).not.toHaveProperty('error_name');
    const logged = JSON.stringify(logContext);
    expect(logged).not.toContain('山田太郎');
    expect(logged).not.toContain('PatientName');
  });

  it('returns a traced no-store error when the auth dependency throws', async () => {
    const thrownError = new Error('session provider unavailable');
    requireAuthContextMock.mockRejectedValueOnce(thrownError);

    const response = await GET(createRequest(), emptyRouteContext);

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expect(response.headers.get('X-Request-Id')).toBe('generated_request_1');
    expect(response.headers.get('X-Correlation-Id')).toBe('correlation_1');
    expect(billingCandidateFindManyMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_auth_unhandled_error',
        route: '/api/billing-evidence/analytics',
        method: 'GET',
        requestId: 'generated_request_1',
        correlationId: 'correlation_1',
      },
      thrownError,
    );
  });
});
