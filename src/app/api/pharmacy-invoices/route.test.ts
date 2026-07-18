import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withOrgContextMock,
  pharmacyInvoiceCountMock,
  pharmacyInvoiceFindManyMock,
  createPharmacyInvoiceDraftMock,
  MockPharmacyInvoiceDraftError,
} = vi.hoisted(() => {
  class MockPharmacyInvoiceDraftError extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly details?: Record<string, unknown>,
    ) {
      super(message);
      this.name = 'PharmacyInvoiceDraftError';
    }
  }
  return {
    withOrgContextMock: vi.fn(),
    pharmacyInvoiceCountMock: vi.fn(),
    pharmacyInvoiceFindManyMock: vi.fn(),
    createPharmacyInvoiceDraftMock: vi.fn(),
    MockPharmacyInvoiceDraftError,
  };
});

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

vi.mock('@/server/services/pharmacy-invoices', () => ({
  createPharmacyInvoiceDraft: createPharmacyInvoiceDraftMock,
  PharmacyInvoiceDraftError: MockPharmacyInvoiceDraftError,
}));

import { GET as rawGET, POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/pharmacy-invoices', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createGetRequest(url = 'http://localhost/api/pharmacy-invoices?billing_month=2026-06-01') {
  return new NextRequest(url);
}

function listedInvoice(id = 'invoice_1') {
  return {
    id,
    contract_id: 'contract_1',
    document_kind: 'invoice',
    invoice_no: id === 'invoice_1' ? 'INV-001' : `INV-${id}`,
    billing_month: new Date('2026-06-01T00:00:00.000Z'),
    subtotal: 5500,
    tax_amount: 550,
    total: 6050,
    status: 'draft',
    issued_at: null,
    sent_at: null,
    received_at: null,
    payment_scheduled_for: null,
    paid_at: null,
    version: 1,
    created_at: new Date('2026-06-20T00:00:00.000Z'),
    updated_at: new Date('2026-06-20T00:00:00.000Z'),
    _count: { items: 1 },
    contract: {
      partnership: {
        base_site: { id: 'site_1', name: '基幹薬局' },
        partner_pharmacy: { id: 'partner_pharmacy_1', name: '協力薬局', status: 'active' },
      },
    },
  };
}

describe('/api/pharmacy-invoices GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pharmacyInvoiceCountMock.mockResolvedValue(1);
    pharmacyInvoiceFindManyMock.mockResolvedValue([listedInvoice()]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        pharmacyInvoice: {
          count: pharmacyInvoiceCountMock,
          findMany: pharmacyInvoiceFindManyMock,
        },
      }),
    );
  });

  it('lists pharmacy invoices with safe operational fields and no-store headers', async () => {
    const response = await GET(
      createGetRequest(
        'http://localhost/api/pharmacy-invoices?billing_month=2026-06-01&document_kind=invoice&status=draft&contract_id=%20contract_1%20&partner_pharmacy_id=%20partner_pharmacy_1%20',
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(pharmacyInvoiceFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          billing_month: new Date('2026-06-01T00:00:00.000Z'),
          document_kind: 'invoice',
          status: 'draft',
          contract_id: 'contract_1',
          contract: { partnership: { partner_pharmacy_id: 'partner_pharmacy_1' } },
        }),
        select: expect.not.objectContaining({
          snapshot: expect.anything(),
          issuer_snapshot: expect.anything(),
          recipient_snapshot: expect.anything(),
          items: expect.anything(),
        }),
      }),
    );
    const payload = await response.json();
    expect(Object.keys(payload).sort()).toEqual(['data', 'meta']);
    expect(payload).toMatchObject({
      data: [
        {
          id: 'invoice_1',
          billing_month: '2026-06-01',
          total: 6050,
          version: 1,
          item_count: 1,
          partnership: {
            partner_pharmacy: { name: '協力薬局' },
          },
        },
      ],
      meta: {
        limit: 50,
        has_more: false,
        next_cursor: null,
        returned_count: 1,
        total_count: 1,
        count_basis: 'filtered_query_exact',
        filters_applied: {
          billing_month: '2026-06-01',
          status: 'draft',
          document_kind: 'invoice',
          contract_id: 'contract_1',
          partner_pharmacy_id: 'partner_pharmacy_1',
        },
      },
    });
    expect(pharmacyInvoiceCountMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        org_id: 'org_1',
        contract: { partnership: { partner_pharmacy_id: 'partner_pharmacy_1' } },
      }),
    });
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      isolationLevel: 'RepeatableRead',
    });
  });

  it('returns 20 of 21 filtered rows with an exact total and stable id cursor', async () => {
    pharmacyInvoiceCountMock.mockResolvedValueOnce(21);
    pharmacyInvoiceFindManyMock.mockResolvedValueOnce(
      Array.from({ length: 21 }, (_, index) => listedInvoice(`invoice_${21 - index}`)),
    );

    const response = await GET(
      createGetRequest(
        'http://localhost/api/pharmacy-invoices?billing_month=2026-06-01&status=draft&partner_pharmacy_id=partner_pharmacy_1&limit=20',
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(20);
    expect(body.meta).toMatchObject({
      limit: 20,
      has_more: true,
      next_cursor: 'invoice_2',
      returned_count: 20,
      total_count: 21,
      count_basis: 'filtered_query_exact',
      filters_applied: {
        billing_month: '2026-06-01',
        status: 'draft',
        partner_pharmacy_id: 'partner_pharmacy_1',
      },
    });
    expect(pharmacyInvoiceFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 21,
        orderBy: [{ billing_month: 'desc' }, { created_at: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it.each([
    ['status', 'status=', { status: ['ステータスを指定してください'] }],
    ['blank status', 'status=%20%20', { status: ['ステータスを指定してください'] }],
    ['document_kind', 'document_kind=', { document_kind: ['文書種別を指定してください'] }],
    [
      'blank document_kind',
      'document_kind=%20%20',
      { document_kind: ['文書種別を指定してください'] },
    ],
    ['billing_month', 'billing_month=', { billing_month: ['請求月を指定してください'] }],
    [
      'blank billing_month',
      'billing_month=%20%20',
      { billing_month: ['請求月を指定してください'] },
    ],
    ['contract_id', 'contract_id=', { contract_id: ['契約IDを指定してください'] }],
    ['blank contract_id', 'contract_id=%20%20', { contract_id: ['契約IDを指定してください'] }],
    [
      'partner_pharmacy_id',
      'partner_pharmacy_id=',
      { partner_pharmacy_id: ['協力薬局IDを指定してください'] },
    ],
    [
      'blank partner_pharmacy_id',
      'partner_pharmacy_id=%20%20',
      { partner_pharmacy_id: ['協力薬局IDを指定してください'] },
    ],
  ])(
    'rejects explicitly empty %s filters before database access',
    async (_label, query, details) => {
      const response = await GET(
        createGetRequest(`http://localhost/api/pharmacy-invoices?${query}`),
      );

      expect(response.status).toBe(400);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        details,
      });
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(pharmacyInvoiceFindManyMock).not.toHaveBeenCalled();
    },
  );

  it('rejects invalid list filters before database access', async () => {
    const response = await GET(
      createGetRequest('http://localhost/api/pharmacy-invoices?document_kind=invalid'),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(pharmacyInvoiceFindManyMock).not.toHaveBeenCalled();
  });
});

describe('/api/pharmacy-invoices POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createPharmacyInvoiceDraftMock.mockResolvedValue({
      reused: false,
      candidate_count: 1,
      invoice: {
        id: 'invoice_1',
        contract_id: 'contract_1',
        document_kind: 'invoice',
        billing_month: '2026-06-01',
        subtotal: 5500,
        tax_amount: 550,
        total: 6050,
        status: 'draft',
        version: 1,
        reused_existing_draft: false,
        item_count: 1,
        items: [],
      },
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) => callback({ tx: true }));
  });

  it('creates a pharmacy invoice draft through the service with no-store response headers', async () => {
    const response = await POST(
      createRequest({
        billing_month: '2026-06-01',
        contract_id: 'contract_1',
        document_kind: 'invoice',
      }),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(withOrgContextMock).toHaveBeenCalledWith(
      'org_1',
      expect.any(Function),
      expect.objectContaining({ isolationLevel: expect.any(String) }),
    );
    expect(createPharmacyInvoiceDraftMock).toHaveBeenCalledWith(
      { tx: true },
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        contractId: 'contract_1',
        documentKind: 'invoice',
        billingMonth: expect.objectContaining({ canonical: '2026-06-01' }),
      }),
    );
    const body = await response.json();
    expect(body).toMatchObject({
      data: {
        message: '薬局間請求書ドラフトを作成しました',
        id: 'invoice_1',
        total: 6050,
        version: 1,
      },
    });
    expect(body).not.toHaveProperty('id');
  });

  it('returns existing active draft idempotently', async () => {
    createPharmacyInvoiceDraftMock.mockResolvedValue({
      reused: true,
      candidate_count: 1,
      invoice: {
        id: 'invoice_existing',
        contract_id: 'contract_1',
        document_kind: 'free_cooperation_report',
        billing_month: '2026-06-01',
        subtotal: 0,
        tax_amount: 0,
        total: 0,
        status: 'draft',
        version: 1,
        reused_existing_draft: true,
        item_count: 1,
        items: [],
      },
    });

    const response = await POST(
      createRequest({
        billing_month: '2026-06-01',
        contract_id: 'contract_1',
        document_kind: 'free_cooperation_report',
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      data: {
        message: '既存の薬局間請求書ドラフトを返しました',
        id: 'invoice_existing',
        version: 1,
        reused_existing_draft: true,
      },
    });
    expect(body).not.toHaveProperty('id');
  });

  it('rejects invalid billing month before transaction side effects', async () => {
    const response = await POST(
      createRequest({
        billing_month: '2026-06-15',
        contract_id: 'contract_1',
        document_kind: 'invoice',
      }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(createPharmacyInvoiceDraftMock).not.toHaveBeenCalled();
  });

  it('maps service no-eligible-candidates errors to conflict responses', async () => {
    createPharmacyInvoiceDraftMock.mockRejectedValue(
      new MockPharmacyInvoiceDraftError('NO_ELIGIBLE_CANDIDATES', '対象の請求候補がありません', {
        contract_id: 'contract_1',
      }),
    );

    const response = await POST(
      createRequest({
        billing_month: '2026-06-01',
        contract_id: 'contract_1',
        document_kind: 'invoice',
      }),
    );

    expect(response.status).toBe(409);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '対象の請求候補がありません',
    });
  });
});
