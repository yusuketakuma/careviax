import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const {
  authContext,
  requireAuthContextMock,
  runWithRequestAuthContextMock,
  withRoutePerformanceMock,
  loggerErrorMock,
  withOrgContextMock,
  partnerVisitRecordCountMock,
  visitBillingCandidateFindManyMock,
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
    withRoutePerformanceMock: vi.fn((_req, handler) => handler()),
    loggerErrorMock: vi.fn(),
    withOrgContextMock: vi.fn(),
    partnerVisitRecordCountMock: vi.fn(),
    visitBillingCandidateFindManyMock: vi.fn(),
  };
});

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/auth/request-context', () => ({
  runWithRequestAuthContext: runWithRequestAuthContextMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
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

function createRequest(search = '') {
  return new NextRequest(`http://localhost/api/visit-billing-candidates/summary${search}`, {
    method: 'GET',
  });
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/visit-billing-candidates/summary GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({ ctx: authContext });
    runWithRequestAuthContextMock.mockImplementation((_ctx, callback) => callback());
    withRoutePerformanceMock.mockImplementation((_req, handler) => handler());
    partnerVisitRecordCountMock.mockResolvedValueOnce(5).mockResolvedValueOnce(3);
    visitBillingCandidateFindManyMock.mockResolvedValue([
      {
        id: 'candidate_paid',
        billing_status: 'candidate',
        is_billable: true,
        amount_snapshot: {
          billing_model: 'fixed_per_visit',
          amount: 5500,
        },
      },
      {
        id: 'candidate_free',
        billing_status: 'candidate',
        is_billable: true,
        amount_snapshot: {
          billing_model: 'free',
          amount: 0,
        },
      },
      {
        id: 'candidate_excluded',
        billing_status: 'excluded',
        is_billable: false,
        amount_snapshot: {
          billing_model: null,
          amount: null,
        },
      },
    ]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        partnerVisitRecord: {
          count: partnerVisitRecordCountMock,
        },
        visitBillingCandidate: {
          findMany: visitBillingCandidateFindManyMock,
        },
      }),
    );
  });

  it('returns a PHI-free monthly visit billing summary with optional filters', async () => {
    const response = await GET(
      createRequest(
        '?billing_month=2026-06-01&share_case_id=share_case_1&partner_pharmacy_id=partner_1',
      ),
    );

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(withRoutePerformanceMock).toHaveBeenCalledTimes(1);
    expect(withRoutePerformanceMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.any(Function),
    );
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canManageBilling',
      message: '薬局間協力訪問の月次実績閲覧権限がありません',
    });
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(authContext, expect.any(Function));
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: authContext,
    });
    expect(partnerVisitRecordCountMock).toHaveBeenNthCalledWith(1, {
      where: {
        org_id: 'org_1',
        visit_at: {
          gte: new Date('2026-06-01T00:00:00.000Z'),
          lt: new Date('2026-07-01T00:00:00.000Z'),
        },
        share_case_id: 'share_case_1',
        owner_partner_pharmacy_id: 'partner_1',
      },
    });
    expect(partnerVisitRecordCountMock).toHaveBeenNthCalledWith(2, {
      where: {
        org_id: 'org_1',
        status: 'confirmed',
        confirmed_at: { not: null },
        visit_at: {
          gte: new Date('2026-06-01T00:00:00.000Z'),
          lt: new Date('2026-07-01T00:00:00.000Z'),
        },
        share_case_id: 'share_case_1',
        owner_partner_pharmacy_id: 'partner_1',
      },
    });
    expect(visitBillingCandidateFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        billing_month: new Date('2026-06-01T00:00:00.000Z'),
        partner_visit_record: {
          share_case_id: 'share_case_1',
          owner_partner_pharmacy_id: 'partner_1',
        },
      },
      select: {
        id: true,
        billing_status: true,
        is_billable: true,
        amount_snapshot: true,
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      billing_month: '2026-06-01',
      filters: {
        share_case_id: 'share_case_1',
        partner_pharmacy_id: 'partner_1',
      },
      visit_record_count: 5,
      confirmed_visit_record_count: 3,
      unconfirmed_visit_record_count: 2,
      generated_candidate_count: 3,
      billable_candidate_count: 2,
      excluded_candidate_count: 1,
      free_candidate_count: 1,
      paid_candidate_count: 1,
      planned_invoice_amount: 5500,
      pending_candidate_generation_count: 0,
    });
  });

  it.each([
    [
      'share_case_id',
      '?billing_month=2026-06-01&share_case_id=',
      { share_case_id: ['患者共有ケースIDを指定してください'] },
    ],
    [
      'blank share_case_id',
      '?billing_month=2026-06-01&share_case_id=%20%20',
      { share_case_id: ['患者共有ケースIDを指定してください'] },
    ],
    [
      'partner_pharmacy_id',
      '?billing_month=2026-06-01&partner_pharmacy_id=',
      { partner_pharmacy_id: ['協力薬局IDを指定してください'] },
    ],
    [
      'blank partner_pharmacy_id',
      '?billing_month=2026-06-01&partner_pharmacy_id=%20%20',
      { partner_pharmacy_id: ['協力薬局IDを指定してください'] },
    ],
  ])('rejects explicitly empty %s filters before DB reads', async (_label, query, details) => {
    const response = await GET(createRequest(query));

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details,
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(partnerVisitRecordCountMock).not.toHaveBeenCalled();
    expect(visitBillingCandidateFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects invalid billing months before transaction side effects', async () => {
    const response = await GET(createRequest('?billing_month=2026-06-15'));

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withRoutePerformanceMock).toHaveBeenCalledTimes(1);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(partnerVisitRecordCountMock).not.toHaveBeenCalled();
    expect(visitBillingCandidateFindManyMock).not.toHaveBeenCalled();
  });

  it('wraps auth failure responses in no-store headers before DB reads', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: NextResponse.json({ code: 'AUTH_FORBIDDEN' }, { status: 403 }),
    });

    const response = await GET(createRequest('?billing_month=2026-06-01'));

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(withRoutePerformanceMock).toHaveBeenCalledTimes(1);
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(partnerVisitRecordCountMock).not.toHaveBeenCalled();
    expect(visitBillingCandidateFindManyMock).not.toHaveBeenCalled();
  });

  it('returns a fixed no-store 500 envelope without leaking raw error details', async () => {
    const unsafeError = new Error(
      'share_case_secret patient_secret billing_secret SQL_SECRET stack_secret raw_error_object',
    );
    unsafeError.name =
      'crafted.share_case_secret.patient_secret.billing_secret.SQL_SECRET.stack_secret';
    partnerVisitRecordCountMock.mockReset();
    partnerVisitRecordCountMock.mockRejectedValueOnce(unsafeError);

    const response = await GET(createRequest('?billing_month=2026-06-01'));

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.text();
    expect(body).toContain('INTERNAL_ERROR');
    expect(body).not.toContain('share_case_secret');
    expect(body).not.toContain('patient_secret');
    expect(body).not.toContain('billing_secret');
    expect(body).not.toContain('SQL_SECRET');
    expect(body).not.toContain('stack_secret');
    expect(body).not.toContain('raw_error_object');
    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'visit_billing_candidates_summary_unhandled_error',
        route: '/api/visit-billing-candidates/summary',
        method: 'GET',
        status: 500,
      },
      unsafeError,
    );
    const [routeContext, logError] = loggerErrorMock.mock.calls[0] ?? [];
    expect(logError).toBe(unsafeError);
    expect(routeContext).not.toHaveProperty('error_name');
    const serializedRouteContext = JSON.stringify(routeContext);
    expect(serializedRouteContext).not.toContain('share_case_secret');
    expect(serializedRouteContext).not.toContain('patient_secret');
    expect(serializedRouteContext).not.toContain('billing_secret');
    expect(serializedRouteContext).not.toContain('SQL_SECRET');
    expect(serializedRouteContext).not.toContain('stack_secret');
    expect(serializedRouteContext).not.toContain('raw_error_object');
    expect(serializedRouteContext).not.toContain(unsafeError.name);
  });
});
