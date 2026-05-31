import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  billingEvidenceCountMock,
  billingEvidenceFindManyMock,
  billingRuleCountMock,
  billingCandidateCountMock,
  taskCountMock,
  visitScheduleFindManyMock,
  consentRecordFindManyMock,
  managementPlanFindManyMock,
  careReportCountMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  billingEvidenceCountMock: vi.fn(),
  billingEvidenceFindManyMock: vi.fn(),
  billingRuleCountMock: vi.fn(),
  billingCandidateCountMock: vi.fn(),
  taskCountMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  consentRecordFindManyMock: vi.fn(),
  managementPlanFindManyMock: vi.fn(),
  careReportCountMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
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

import { GET } from './route';

function createRequest() {
  return new NextRequest('http://localhost/api/billing-evidence/stats', {
    headers: {
      'x-org-id': 'org_1',
    },
  });
}

describe('/api/billing-evidence/stats GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-28T15:30:00.000Z'));
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'report_1',
        role: 'clerk',
      },
    });
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
});
