import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withOrgContextMock,
  partnerVisitRecordFindManyMock,
  pharmacyContractVersionFindFirstMock,
  visitBillingCandidateFindManyMock,
  visitBillingCandidateFindUniqueMock,
  visitBillingCandidateCreateMock,
  visitBillingCandidateUpdateManyMock,
  pharmacyVisitRequestUpdateManyMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  partnerVisitRecordFindManyMock: vi.fn(),
  pharmacyContractVersionFindFirstMock: vi.fn(),
  visitBillingCandidateFindManyMock: vi.fn(),
  visitBillingCandidateFindUniqueMock: vi.fn(),
  visitBillingCandidateCreateMock: vi.fn(),
  visitBillingCandidateUpdateManyMock: vi.fn(),
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

import { GET as rawGET, POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/visit-billing-candidates', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createGetRequest(query = '') {
  return new NextRequest(`http://localhost/api/visit-billing-candidates${query}`);
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
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

describe('/api/visit-billing-candidates GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    visitBillingCandidateFindManyMock.mockResolvedValue([]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitBillingCandidate: {
          findMany: visitBillingCandidateFindManyMock,
        },
      }),
    );
  });

  it.each([
    ['status', '?billing_month=2026-06-01&status=', { status: ['ステータスを指定してください'] }],
    [
      'blank status',
      '?billing_month=2026-06-01&status=%20%20',
      { status: ['ステータスを指定してください'] },
    ],
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
    const response = await GET(createGetRequest(query));

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details,
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitBillingCandidateFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects blank billing months before DB reads', async () => {
    const response = await GET(createGetRequest('?billing_month='));

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitBillingCandidateFindManyMock).not.toHaveBeenCalled();
  });

  it('trims valid share case and partner pharmacy filters', async () => {
    const response = await GET(
      createGetRequest(
        '?billing_month=2026-06-01&share_case_id=%20share_case_1%20&partner_pharmacy_id=%20partner_pharmacy_1%20',
      ),
    );

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
    });
    expect(visitBillingCandidateFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          partner_visit_record: {
            share_case_id: 'share_case_1',
            owner_partner_pharmacy_id: 'partner_pharmacy_1',
          },
        }),
      }),
    );
  });

  it('returns a sanitized no-store 500 when listing fails unexpectedly', async () => {
    visitBillingCandidateFindManyMock.mockRejectedValueOnce(
      new Error('田中 花子 請求候補 raw visit billing list failure'),
    );

    const response = await GET(createGetRequest('?billing_month=2026-06-01'));

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('田中 花子');
    expect(bodyText).not.toContain('請求候補');
    expect(bodyText).not.toContain('raw visit billing list failure');
  });
});

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
    visitBillingCandidateFindManyMock.mockResolvedValue([]);
    visitBillingCandidateCreateMock.mockResolvedValue({
      id: 'visit_billing_candidate_1',
      billing_status: 'candidate',
      is_billable: true,
    });
    visitBillingCandidateUpdateManyMock.mockResolvedValue({ count: 1 });
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
          updateMany: visitBillingCandidateUpdateManyMock,
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
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
    });
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
    expect(visitBillingCandidateFindManyMock).toHaveBeenCalledTimes(1);
    expect(visitBillingCandidateFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        partner_visit_record_id: { in: ['partner_visit_record_1'] },
      },
      select: {
        id: true,
        partner_visit_record_id: true,
        billing_status: true,
        invoice_items: {
          select: { id: true },
          take: 1,
        },
      },
    });
    expect(visitBillingCandidateFindUniqueMock).not.toHaveBeenCalled();
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
    expect(visitBillingCandidateUpdateManyMock).not.toHaveBeenCalled();
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

  it('batch-loads existing candidates once for multiple confirmed records', async () => {
    partnerVisitRecordFindManyMock.mockResolvedValue([
      confirmedPartnerRecord(),
      confirmedPartnerRecord({
        id: 'partner_visit_record_2',
        visit_request: {
          id: 'visit_request_2',
          status: 'confirmed',
          contract_version_id: 'contract_version_1',
        },
      }),
    ]);
    visitBillingCandidateCreateMock
      .mockResolvedValueOnce({
        id: 'visit_billing_candidate_1',
        billing_status: 'candidate',
        is_billable: true,
      })
      .mockResolvedValueOnce({
        id: 'visit_billing_candidate_2',
        billing_status: 'candidate',
        is_billable: true,
      });

    const response = await POST(createRequest({ billing_month: '2026-06-01' }));

    expect(response.status).toBe(200);
    expect(visitBillingCandidateFindManyMock).toHaveBeenCalledTimes(1);
    expect(visitBillingCandidateFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          partner_visit_record_id: {
            in: ['partner_visit_record_1', 'partner_visit_record_2'],
          },
        },
      }),
    );
    expect(visitBillingCandidateFindUniqueMock).not.toHaveBeenCalled();
    expect(visitBillingCandidateCreateMock).toHaveBeenCalledTimes(2);
    await expect(response.json()).resolves.toMatchObject({
      generated_candidates: 2,
      billable_count: 2,
      skipped_locked_count: 0,
      candidate_ids: ['visit_billing_candidate_1', 'visit_billing_candidate_2'],
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
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitBillingCandidateCreateMock).not.toHaveBeenCalled();
    expect(visitBillingCandidateUpdateManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('does not preflight existing candidates when no confirmed records match', async () => {
    partnerVisitRecordFindManyMock.mockResolvedValue([]);

    const response = await POST(createRequest({ billing_month: '2026-06-01' }));

    expect(response.status).toBe(200);
    expect(visitBillingCandidateFindManyMock).not.toHaveBeenCalled();
    expect(visitBillingCandidateFindUniqueMock).not.toHaveBeenCalled();
    expect(visitBillingCandidateCreateMock).not.toHaveBeenCalled();
    expect(visitBillingCandidateUpdateManyMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      scanned_confirmed_records: 0,
      generated_candidates: 0,
      candidate_ids: [],
    });
  });

  it('does not mutate confirmed or invoice-linked candidates during regeneration', async () => {
    visitBillingCandidateFindManyMock.mockResolvedValue([
      {
        id: 'visit_billing_candidate_locked',
        partner_visit_record_id: 'partner_visit_record_1',
        billing_status: 'invoiced',
        invoice_items: [{ id: 'invoice_item_1' }],
      },
    ]);
    visitBillingCandidateFindUniqueMock.mockResolvedValue({
      id: 'visit_billing_candidate_locked',
      billing_status: 'invoiced',
      invoice_items: [{ id: 'invoice_item_1' }],
    });

    const response = await POST(createRequest({ billing_month: '2026-06-01' }));

    expect(response.status).toBe(200);
    expect(visitBillingCandidateCreateMock).not.toHaveBeenCalled();
    expect(visitBillingCandidateUpdateManyMock).not.toHaveBeenCalled();
    expect(visitBillingCandidateFindUniqueMock).not.toHaveBeenCalled();
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

  it('skips candidates that become locked after the preflight read', async () => {
    visitBillingCandidateFindManyMock.mockResolvedValue([
      {
        id: 'visit_billing_candidate_raced',
        partner_visit_record_id: 'partner_visit_record_1',
        billing_status: 'candidate',
        invoice_items: [],
      },
    ]);
    visitBillingCandidateUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await POST(createRequest({ billing_month: '2026-06-01' }));

    expect(response.status).toBe(200);
    expect(visitBillingCandidateCreateMock).not.toHaveBeenCalled();
    expect(visitBillingCandidateUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'visit_billing_candidate_raced',
        org_id: 'org_1',
        billing_status: { in: ['candidate', 'excluded'] },
        invoice_items: { none: {} },
      },
      data: expect.objectContaining({
        billing_month: new Date('2026-06-01T00:00:00.000Z'),
        billing_status: 'candidate',
        is_billable: true,
      }),
    });
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
      candidate_ids: ['visit_billing_candidate_raced'],
    });
  });

  it('reuses a concurrently created candidate when create hits the unique constraint', async () => {
    visitBillingCandidateFindUniqueMock.mockResolvedValueOnce({
      id: 'visit_billing_candidate_concurrent',
      billing_status: 'candidate',
      invoice_items: [],
    });
    visitBillingCandidateCreateMock.mockRejectedValueOnce({ code: 'P2002' });

    const response = await POST(createRequest({ billing_month: '2026-06-01' }));

    expect(response.status).toBe(200);
    expect(visitBillingCandidateFindManyMock).toHaveBeenCalledTimes(1);
    expect(visitBillingCandidateFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          partner_visit_record_id: { in: ['partner_visit_record_1'] },
        },
      }),
    );
    expect(visitBillingCandidateCreateMock).toHaveBeenCalledTimes(1);
    expect(visitBillingCandidateFindUniqueMock).toHaveBeenCalledTimes(1);
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
    expect(visitBillingCandidateUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'visit_billing_candidate_concurrent',
        org_id: 'org_1',
        billing_status: { in: ['candidate', 'excluded'] },
        invoice_items: { none: {} },
      },
      data: expect.objectContaining({
        billing_month: new Date('2026-06-01T00:00:00.000Z'),
        billing_status: 'candidate',
        is_billable: true,
      }),
    });
    await expect(response.json()).resolves.toMatchObject({
      generated_candidates: 1,
      skipped_locked_count: 0,
      candidate_ids: ['visit_billing_candidate_concurrent'],
    });
  });

  it('returns a sanitized no-store 500 when candidate generation fails unexpectedly', async () => {
    visitBillingCandidateCreateMock.mockRejectedValueOnce(
      new Error('佐藤 太郎 協力訪問 raw visit billing generation failure'),
    );

    const response = await POST(createRequest({ billing_month: '2026-06-01' }));

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('佐藤 太郎');
    expect(bodyText).not.toContain('協力訪問');
    expect(bodyText).not.toContain('raw visit billing generation failure');
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
