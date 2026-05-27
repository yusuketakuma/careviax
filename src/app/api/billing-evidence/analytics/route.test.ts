import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  billingCandidateFindManyMock,
  billingEvidenceFindManyMock,
  billingRuleCountMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  billingCandidateFindManyMock: vi.fn(),
  billingEvidenceFindManyMock: vi.fn(),
  billingRuleCountMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    billingCandidate: {
      findMany: billingCandidateFindManyMock,
    },
    billingEvidence: {
      findMany: billingEvidenceFindManyMock,
    },
    billingRule: {
      count: billingRuleCountMock,
    },
  },
}));

import { GET } from './route';

function createRequest() {
  return {
    headers: {
      get: () => 'org_1',
    },
  } as unknown as NextRequest;
}

describe('/api/billing-evidence/analytics GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-28T15:30:00.000Z'));
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'report_1',
        role: 'manager',
      },
    });
    billingRuleCountMock.mockResolvedValue(16);
    billingCandidateFindManyMock.mockResolvedValue([
      {
        billing_month: new Date('2026-03-01T00:00:00.000Z'),
        status: 'candidate',
        billing_code: 'M001',
        billing_name: '在宅患者訪問薬剤管理指導料',
        source_snapshot: { revision_code: '2026' },
      },
      {
        billing_month: new Date('2026-03-01T00:00:00.000Z'),
        status: 'confirmed',
        billing_code: 'M001',
        billing_name: '在宅患者訪問薬剤管理指導料',
        source_snapshot: { revision_code: '2026' },
      },
      {
        billing_month: new Date('2026-03-01T00:00:00.000Z'),
        status: 'exported',
        billing_code: 'A010',
        billing_name: '麻薬加算',
        source_snapshot: { revision_code: '2024' },
      },
    ]);
    billingEvidenceFindManyMock.mockResolvedValue([
      {
        billing_month: new Date('2026-03-01T00:00:00.000Z'),
        claimable: true,
        exclusion_reason: null,
        calculation_context: {
          effective_revision_code: '2026',
          site_config_status: 'resolved',
        },
      },
      {
        billing_month: new Date('2026-03-01T00:00:00.000Z'),
        claimable: false,
        exclusion_reason: '報告書送付が未完了です',
        calculation_context: {
          effective_revision_code: '2024',
          site_config_status: 'revision_mismatch',
        },
      },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns monthly operational analytics', async () => {
    const response = await GET(createRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
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
          current_month_revision_counts: expect.any(Object),
          current_month_site_config_issue_count: expect.any(Number),
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
    expect(billingEvidenceFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          billing_month: {
            gte: rangeStart,
          },
        }),
      }),
    );
  });
});
