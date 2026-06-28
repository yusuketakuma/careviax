import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const {
  authContext,
  requireAuthContextMock,
  runWithRequestAuthContextMock,
  loggerErrorMock,
  withRoutePerformanceMock,
  billingEvidenceCountMock,
  billingEvidenceFindManyMock,
  billingRuleCountMock,
  billingCandidateCountMock,
  taskCountMock,
  visitScheduleFindManyMock,
  consentRecordFindManyMock,
  managementPlanFindManyMock,
  careReportCountMock,
} = vi.hoisted(() => {
  const authContext = {
    orgId: 'org_1',
    userId: 'report_1',
    role: 'clerk',
  };

  return {
    authContext,
    requireAuthContextMock: vi.fn(),
    runWithRequestAuthContextMock: vi.fn((_ctx, callback) => callback()),
    loggerErrorMock: vi.fn(),
    withRoutePerformanceMock: vi.fn((_req, handler) => handler()),
    billingEvidenceCountMock: vi.fn(),
    billingEvidenceFindManyMock: vi.fn(),
    billingRuleCountMock: vi.fn(),
    billingCandidateCountMock: vi.fn(),
    taskCountMock: vi.fn(),
    visitScheduleFindManyMock: vi.fn(),
    consentRecordFindManyMock: vi.fn(),
    managementPlanFindManyMock: vi.fn(),
    careReportCountMock: vi.fn(),
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
    billingEvidence: {
      count: billingEvidenceCountMock,
      findMany: billingEvidenceFindManyMock,
    },
    visitSchedule: {
      findMany: visitScheduleFindManyMock,
    },
    consentRecord: {
      findMany: consentRecordFindManyMock,
    },
    managementPlan: {
      findMany: managementPlanFindManyMock,
    },
    careReport: {
      count: careReportCountMock,
    },
    billingRule: {
      count: billingRuleCountMock,
    },
    billingCandidate: {
      count: billingCandidateCountMock,
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

import { GET } from './route';

function createRequest() {
  return new NextRequest('http://localhost/api/billing-evidence/stats', {
    headers: {
      'x-org-id': 'org_1',
    },
  });
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/billing-evidence/stats GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-28T15:30:00.000Z'));
    requireAuthContextMock.mockResolvedValue({ ctx: authContext });
    runWithRequestAuthContextMock.mockImplementation((_ctx, callback) => callback());
    withRoutePerformanceMock.mockImplementation((_req, handler) => handler());
    billingEvidenceCountMock
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1);
    billingRuleCountMock.mockResolvedValue(16);
    billingCandidateCountMock
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(11)
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(3);
    billingEvidenceFindManyMock.mockResolvedValue([
      {
        claimable: true,
        exclusion_reason: null,
        calculation_context: {
          effective_revision_code: '2026',
          site_config_status: 'resolved',
        },
      },
      {
        claimable: false,
        exclusion_reason: '同意未取得',
        calculation_context: {
          effective_revision_code: '2024',
          site_config_status: 'config_missing',
        },
      },
      {
        claimable: false,
        exclusion_reason: null,
        calculation_context: ['unexpected'],
      },
    ]);
    taskCountMock.mockResolvedValue(6);
    visitScheduleFindManyMock.mockResolvedValue([
      {
        case_id: 'case_1',
        case_: { patient_id: 'patient_1' },
      },
      {
        case_id: 'case_2',
        case_: { patient_id: 'patient_2' },
      },
    ]);
    consentRecordFindManyMock.mockResolvedValue([{ patient_id: 'patient_1' }]);
    managementPlanFindManyMock.mockResolvedValue([{ case_id: 'case_1' }]);
    careReportCountMock.mockResolvedValue(5);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns SSOT-aware billing evidence stats', async () => {
    const response = await GET(createRequest());

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(200);
    expect(withRoutePerformanceMock).toHaveBeenCalledTimes(1);
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canReport',
      message: '請求根拠統計の閲覧権限がありません',
    });
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(authContext, expect.any(Function));
    expectSensitiveNoStore(resolvedResponse);
    await expect(resolvedResponse.json()).resolves.toMatchObject({
      data: {
        not_claimable: 2,
        evidence_insufficient: 3,
        delivery_incomplete: 1,
        ssot_rule_count: 16,
        confirmed_candidates: 7,
        review_required_candidates: 4,
        exported_candidates: 2,
        current_month_candidates: 11,
        current_month_claimable_evidence: 1,
        current_month_unclaimable_evidence: 2,
        current_month_revision_breakdown: {
          '2024': 1,
          '2026': 1,
          unknown: 1,
        },
        current_month_site_config_issues: {
          missing: 1,
          revision_mismatch: 0,
        },
        current_month_close_ready: 8,
        current_month_close_blocked: 3,
        open_billing_review_tasks: 6,
        previsit_blockers: 1,
        undrafted_reports: 5,
      },
    });
    const marchBillingMonth = new Date('2026-03-01T00:00:00.000Z');
    expect(billingEvidenceFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          billing_month: marchBillingMonth,
        }),
      }),
    );
    expect(billingCandidateCountMock).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        where: expect.objectContaining({
          billing_month: marchBillingMonth,
        }),
      }),
    );
    expect(visitScheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          scheduled_date: {
            gte: marchBillingMonth,
          },
        }),
      }),
    );
  });

  it('wraps auth failure responses in no-store headers before any billing lookup', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: NextResponse.json({ code: 'AUTH_FORBIDDEN' }, { status: 403 }),
    });

    const response = await GET(createRequest());

    expect(response.status).toBe(403);
    expect(withRoutePerformanceMock).toHaveBeenCalledTimes(1);
    expectSensitiveNoStore(response);
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(billingEvidenceCountMock).not.toHaveBeenCalled();
    expect(billingEvidenceFindManyMock).not.toHaveBeenCalled();
    expect(billingCandidateCountMock).not.toHaveBeenCalled();
    expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
  });

  it('returns a no-store fixed error without leaking raw billing evidence failures', async () => {
    billingEvidenceCountMock.mockReset();
    billingEvidenceCountMock.mockRejectedValueOnce(
      new Error('patient 山田太郎 billing stats failed'),
    );

    const response = await GET(createRequest());

    expect(response.status).toBe(500);
    expect(withRoutePerformanceMock).toHaveBeenCalledTimes(1);
    expectSensitiveNoStore(response);
    const body = await response.text();
    expect(body).toContain('INTERNAL_ERROR');
    expect(body).not.toContain('patient 山田太郎');
    expect(body).not.toContain('billing stats failed');
    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'billing_evidence_stats_unhandled_error',
      undefined,
      {
        event: 'billing_evidence_stats_unhandled_error',
        route: '/api/billing-evidence/stats',
        method: 'GET',
        status: 500,
        error_name: 'Error',
      },
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('patient 山田太郎');
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('billing stats failed');
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('stack');
  });
});
