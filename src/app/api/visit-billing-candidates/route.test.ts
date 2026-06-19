import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withOrgContextMock,
  partnerVisitRecordFindManyMock,
  pharmacyContractVersionFindFirstMock,
  visitBillingCandidateFindManyMock,
  visitBillingCandidateFindUniqueMock,
  visitBillingCandidateCreateMock,
  visitBillingCandidateUpdateMock,
  pharmacyVisitRequestUpdateManyMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  partnerVisitRecordFindManyMock: vi.fn(),
  pharmacyContractVersionFindFirstMock: vi.fn(),
  visitBillingCandidateFindManyMock: vi.fn(),
  visitBillingCandidateFindUniqueMock: vi.fn(),
  visitBillingCandidateCreateMock: vi.fn(),
  visitBillingCandidateUpdateMock: vi.fn(),
  pharmacyVisitRequestUpdateManyMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
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

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

import { POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/visit-billing-candidates', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function confirmedPartnerRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'partner_visit_record_1',
    status: 'confirmed',
    visit_at: new Date('2026-06-19T02:00:00.000Z'),
    confirmed_at: new Date('2026-06-19T03:00:00.000Z'),
    visit_request: {
      id: 'visit_request_1',
      status: 'confirmed',
      contract_version_id: 'contract_version_1',
    },
    share_case: {
      partnership_id: 'partnership_1',
      consents: [
        {
          consent_date: new Date('2026-06-01T00:00:00.000Z'),
          valid_until: new Date('2026-12-31T00:00:00.000Z'),
          revoked_at: null,
        },
      ],
    },
    ...overrides,
  };
}

describe('/api/visit-billing-candidates POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    partnerVisitRecordFindManyMock.mockResolvedValue([confirmedPartnerRecord()]);
    pharmacyContractVersionFindFirstMock.mockResolvedValue({
      id: 'contract_version_1',
      effective_from: new Date('2026-06-01T00:00:00.000Z'),
      effective_to: new Date('2026-06-30T00:00:00.000Z'),
      fee_rules: [
        {
          id: 'fee_rule_1',
          billing_model: 'fixed_per_visit',
          unit_price: 5500,
          tax_category: 'taxable',
          tax_rate_bp: 1000,
        },
      ],
    });
    visitBillingCandidateFindUniqueMock.mockResolvedValue(null);
    visitBillingCandidateCreateMock.mockResolvedValue({
      id: 'visit_billing_candidate_1',
      billing_status: 'candidate',
      is_billable: true,
    });
    visitBillingCandidateUpdateMock.mockResolvedValue({
      id: 'visit_billing_candidate_1',
      billing_status: 'candidate',
      is_billable: true,
    });
    pharmacyVisitRequestUpdateManyMock.mockResolvedValue({ count: 1 });
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        partnerVisitRecord: {
          findMany: partnerVisitRecordFindManyMock,
        },
        pharmacyContractVersion: {
          findFirst: pharmacyContractVersionFindFirstMock,
        },
        visitBillingCandidate: {
          findMany: visitBillingCandidateFindManyMock,
          findUnique: visitBillingCandidateFindUniqueMock,
          create: visitBillingCandidateCreateMock,
          update: visitBillingCandidateUpdateMock,
        },
        pharmacyVisitRequest: {
          updateMany: pharmacyVisitRequestUpdateManyMock,
        },
      }),
    );
  });

  it('generates billable candidates only from confirmed claim-ready partner visit records', async () => {
    const response = await POST(createRequest({ billing_month: '2026-06-01' }));

    expect(response.status).toBe(200);
    expect(partnerVisitRecordFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        status: 'confirmed',
        confirmed_at: { not: null },
        visit_at: {
          gte: new Date('2026-06-01T00:00:00.000Z'),
          lt: new Date('2026-07-01T00:00:00.000Z'),
        },
        visit_request: {
          status: { in: ['confirmed', 'physician_report_created', 'claim_checked', 'completed'] },
        },
      },
      select: expect.any(Object),
    });
    expect(pharmacyContractVersionFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'contract_version_1',
          org_id: 'org_1',
          status: 'active',
        }),
      }),
    );
    expect(visitBillingCandidateFindUniqueMock).toHaveBeenCalledWith({
      where: {
        org_id_partner_visit_record_id: {
          org_id: 'org_1',
          partner_visit_record_id: 'partner_visit_record_1',
        },
      },
      select: {
        id: true,
        billing_status: true,
        invoice_items: {
          select: { id: true },
          take: 1,
        },
      },
    });
    expect(visitBillingCandidateCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        partner_visit_record_id: 'partner_visit_record_1',
        contract_version_id: 'contract_version_1',
        billing_month: new Date('2026-06-01T00:00:00.000Z'),
        billing_status: 'candidate',
        is_billable: true,
        exclusion_reason: null,
        amount_snapshot: expect.objectContaining({
          amount: 5500,
          billing_model: 'fixed_per_visit',
          blockers: [],
        }),
      }),
    });
    expect(visitBillingCandidateUpdateMock).not.toHaveBeenCalled();
    expect(pharmacyVisitRequestUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'visit_request_1',
        org_id: 'org_1',
        status: { in: ['confirmed', 'physician_report_created'] },
      },
      data: { status: 'claim_checked' },
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        action: 'visit_billing_candidates_generated',
        changes: expect.objectContaining({
          billing_month: '2026-06-01',
          scanned_confirmed_records: 1,
          generated_candidates: 1,
          billable_count: 1,
          excluded_count: 0,
          skipped_locked_count: 0,
        }),
      }),
    );
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    await expect(response.json()).resolves.toMatchObject({
      generated_candidates: 1,
      billable_count: 1,
      excluded_count: 0,
      skipped_locked_count: 0,
      candidate_ids_truncated: false,
    });
  });

  it('stores confirmed records without an effective contract version as excluded candidates', async () => {
    pharmacyContractVersionFindFirstMock.mockResolvedValue(null);
    visitBillingCandidateCreateMock.mockResolvedValue({
      id: 'visit_billing_candidate_1',
      billing_status: 'excluded',
      is_billable: false,
    });

    const response = await POST(createRequest({ billing_month: '2026-06-01' }));

    expect(response.status).toBe(200);
    expect(visitBillingCandidateCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contract_version_id: undefined,
          billing_status: 'excluded',
          is_billable: false,
          exclusion_reason: 'missing_contract_version',
          amount_snapshot: expect.objectContaining({
            blockers: ['missing_contract_version'],
          }),
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      generated_candidates: 1,
      billable_count: 0,
      excluded_count: 1,
    });
  });

  it('excludes confirmed records when the contract fee amount is unresolved', async () => {
    pharmacyContractVersionFindFirstMock.mockResolvedValue({
      id: 'contract_version_1',
      effective_from: new Date('2026-06-01T00:00:00.000Z'),
      effective_to: new Date('2026-06-30T00:00:00.000Z'),
      fee_rules: [
        {
          id: 'fee_rule_1',
          billing_model: 'expense_reimbursement',
          unit_price: null,
          tax_category: 'taxable',
          tax_rate_bp: 1000,
        },
      ],
    });
    visitBillingCandidateCreateMock.mockResolvedValue({
      id: 'visit_billing_candidate_1',
      billing_status: 'excluded',
      is_billable: false,
    });

    const response = await POST(createRequest({ billing_month: '2026-06-01' }));

    expect(response.status).toBe(200);
    expect(visitBillingCandidateCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          billing_status: 'excluded',
          is_billable: false,
          exclusion_reason: 'amount_unresolved',
          amount_snapshot: expect.objectContaining({
            amount: null,
            billing_model: 'expense_reimbursement',
            blockers: ['amount_unresolved'],
          }),
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      generated_candidates: 1,
      billable_count: 0,
      excluded_count: 1,
    });
  });

  it('rejects invalid billing months before transaction side effects', async () => {
    const response = await POST(createRequest({ billing_month: '2026-06-15' }));

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitBillingCandidateCreateMock).not.toHaveBeenCalled();
    expect(visitBillingCandidateUpdateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('does not mutate confirmed or invoice-linked candidates during regeneration', async () => {
    visitBillingCandidateFindUniqueMock.mockResolvedValue({
      id: 'visit_billing_candidate_locked',
      billing_status: 'invoiced',
      invoice_items: [{ id: 'invoice_item_1' }],
    });

    const response = await POST(createRequest({ billing_month: '2026-06-01' }));

    expect(response.status).toBe(200);
    expect(visitBillingCandidateCreateMock).not.toHaveBeenCalled();
    expect(visitBillingCandidateUpdateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        changes: expect.objectContaining({
          skipped_locked_count: 1,
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      generated_candidates: 1,
      skipped_locked_count: 1,
      candidate_ids: ['visit_billing_candidate_locked'],
    });
  });
});
