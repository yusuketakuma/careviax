import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  withOrgContextMock,
  visitRecordFindManyMock,
  billingCandidateFindManyMock,
  patientFindManyMock,
  workbenchSummaryMock,
  upsertBillingEvidenceForVisitMock,
  generateBillingCandidatesForMonthMock,
} = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  visitRecordFindManyMock: vi.fn(),
  billingCandidateFindManyMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  workbenchSummaryMock: vi.fn(),
  upsertBillingEvidenceForVisitMock: vi.fn(),
  generateBillingCandidatesForMonthMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: (req: NextRequest & { orgId: string }) => Promise<Response>) => handler,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    visitRecord: {
      findMany: visitRecordFindManyMock,
    },
  },
}));

vi.mock('@/server/services/billing-evidence', () => ({
  getBillingCandidateWorkbenchSummary: workbenchSummaryMock,
  upsertBillingEvidenceForVisit: upsertBillingEvidenceForVisitMock,
  generateBillingCandidatesForMonth: generateBillingCandidatesForMonthMock,
}));

import { GET, POST } from './route';

function createRequest(body: unknown) {
  return {
    orgId: 'org_1',
    json: async () => body,
  } as unknown as NextRequest & { orgId: string };
}

describe('/api/billing-candidates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    visitRecordFindManyMock.mockResolvedValue([{ id: 'visit_1' }, { id: 'visit_2' }]);
    billingCandidateFindManyMock.mockResolvedValue([
      {
        id: 'candidate_1',
        patient_id: 'patient_1',
        status: 'confirmed',
        source_snapshot: {
          billing_close: {
            review_state: 'reviewed',
            resolution_state: 'confirmed',
          },
        },
      },
      {
        id: 'candidate_2',
        patient_id: 'patient_2',
        status: 'candidate',
        source_snapshot: null,
      },
    ]);
    patientFindManyMock.mockResolvedValue([
      { id: 'patient_1', name: '佐藤 花子' },
      { id: 'patient_2', name: '鈴木 一郎' },
    ]);
    workbenchSummaryMock.mockResolvedValue({
      total: 2,
      pending_review: 1,
      confirmed: 1,
      excluded: 0,
      exported: 0,
      reviewed: 1,
      ready_to_close: 1,
      blocked_from_close: 1,
      blocker_reasons: [{ reason: '同意未取得', count: 1 }],
    });
    generateBillingCandidatesForMonthMock.mockResolvedValue([
      { status: 'confirmed' },
      { status: 'candidate' },
      { status: 'excluded' },
    ]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        billingCandidate: {
          findMany: billingCandidateFindManyMock,
        },
        patient: {
          findMany: patientFindManyMock,
        },
      }),
    );
  });

  it('returns billing candidate workbench summary for the selected month', async () => {
    billingCandidateFindManyMock.mockResolvedValueOnce([
      {
        id: 'candidate_1',
        patient_id: 'patient_1',
        status: 'confirmed',
        source_snapshot: {
          billing_close: {
            review_state: 'reviewed',
            resolution_state: 'confirmed',
          },
        },
      },
    ]);
    patientFindManyMock.mockResolvedValueOnce([{ id: 'patient_1', name: '佐藤 花子' }]);

    const response = await GET({
      orgId: 'org_1',
      url: 'http://localhost/api/billing-candidates?billing_month=2026-03-01&patient_id=patient_1&limit=10',
    } as unknown as NextRequest & { orgId: string });

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(200);
    expect(billingCandidateFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          billing_month: new Date('2026-03-01'),
          patient_id: 'patient_1',
        }),
      }),
    );
    expect(workbenchSummaryMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        orgId: 'org_1',
        billingMonth: new Date('2026-03-01'),
        patientId: 'patient_1',
      }),
    );
    expect(patientFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        id: { in: ['patient_1'] },
      },
      select: { id: true, name: true },
    });
    await expect(resolvedResponse.json()).resolves.toMatchObject({
      summary: {
        total: 2,
        pending_review: 1,
        confirmed: 1,
        ready_to_close: 1,
      },
      data: [
        {
          status: 'confirmed',
          patient_name: '佐藤 花子',
          workflow_state: {
            review_state: 'reviewed',
            resolution_state: 'confirmed',
          },
        },
      ],
    });
  });

  it('generates candidate summary using billing evidence service', async () => {
    const response = await POST(createRequest({ billing_month: '2026-03-01' }));

    if (!response) throw new Error('response is required');
    const resolvedResponse = response as Response;
    expect(resolvedResponse.status).toBe(200);
    expect(visitRecordFindManyMock).toHaveBeenCalledOnce();
    expect(upsertBillingEvidenceForVisitMock).toHaveBeenCalledTimes(2);
    expect(generateBillingCandidatesForMonthMock).toHaveBeenCalledWith(
      expect.objectContaining({
        billingCandidate: {
          findMany: billingCandidateFindManyMock,
        },
      }),
      {
        orgId: 'org_1',
        billingMonth: new Date(2026, 2, 1),
      },
    );
    await expect(resolvedResponse.json()).resolves.toMatchObject({
      generated: 3,
      confirmed: 1,
      review_required: 1,
      excluded: 1,
    });
  });
});
