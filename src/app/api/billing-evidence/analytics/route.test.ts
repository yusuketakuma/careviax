import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  billingCandidateFindManyMock,
  billingCandidateGroupByMock,
  billingEvidenceFindManyMock,
  billingEvidenceGroupByMock,
  billingRuleCountMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  billingCandidateFindManyMock: vi.fn(),
  billingCandidateGroupByMock: vi.fn(),
  billingEvidenceFindManyMock: vi.fn(),
  billingEvidenceGroupByMock: vi.fn(),
  billingRuleCountMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
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

import { GET } from './route';

function createRequest() {
  return new NextRequest('http://localhost/api/billing-evidence/analytics', {
    headers: {
      'x-org-id': 'org_1',
    },
  });
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
});
