import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { withOrgContextMock, partnerVisitRecordCountMock, visitBillingCandidateFindManyMock } =
  vi.hoisted(() => ({
    withOrgContextMock: vi.fn(),
    partnerVisitRecordCountMock: vi.fn(),
    visitBillingCandidateFindManyMock: vi.fn(),
  }));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => Promise<Response>) => {
    return (req: NextRequest, routeContext?: unknown) =>
      handler(
        req,
        {
          orgId: 'org_1',
          userId: 'user_1',
          role: 'admin',
        },
        routeContext,
      );
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET as rawGET } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);

function createRequest(search = '') {
  return new NextRequest(`http://localhost/api/visit-billing-candidates/summary${search}`, {
    method: 'GET',
  });
}

describe('/api/visit-billing-candidates/summary GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('rejects invalid billing months before transaction side effects', async () => {
    const response = await GET(createRequest('?billing_month=2026-06-15'));

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(partnerVisitRecordCountMock).not.toHaveBeenCalled();
    expect(visitBillingCandidateFindManyMock).not.toHaveBeenCalled();
  });
});
