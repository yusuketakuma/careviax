import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { withOrgContextMock, transitionPharmacyInvoiceMock, MockPharmacyInvoiceTransitionError } =
  vi.hoisted(() => {
    class MockPharmacyInvoiceTransitionError extends Error {
      constructor(
        readonly code: string,
        message: string,
        readonly details?: Record<string, unknown>,
      ) {
        super(message);
        this.name = 'PharmacyInvoiceTransitionError';
      }
    }
    return {
      withOrgContextMock: vi.fn(),
      transitionPharmacyInvoiceMock: vi.fn(),
      MockPharmacyInvoiceTransitionError,
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
          ipAddress: '127.0.0.1',
          userAgent: 'vitest',
        },
        routeContext,
      );
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/pharmacy-invoices', () => ({
  transitionPharmacyInvoice: transitionPharmacyInvoiceMock,
  PharmacyInvoiceTransitionError: MockPharmacyInvoiceTransitionError,
}));

import { PATCH as rawPATCH } from './route';

const PATCH = (req: NextRequest, id = 'invoice_1') =>
  rawPATCH(req, { params: Promise.resolve({ id }) });

function createRequest(body: unknown, idempotencyKey: string | null = 'invoice-transition-1') {
  return new NextRequest('http://localhost/api/pharmacy-invoices/invoice_1', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('/api/pharmacy-invoices/[id] PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transitionPharmacyInvoiceMock.mockResolvedValue({
      id: 'invoice_1',
      contract_id: 'contract_1',
      document_kind: 'invoice',
      invoice_no: 'INV-202606-0001',
      billing_month: '2026-06-01',
      subtotal: 5500,
      tax_amount: 550,
      total: 6050,
      status: 'issued',
      issued_at: new Date('2026-06-19T00:00:00.000Z'),
      sent_at: null,
      received_at: null,
      payment_scheduled_for: null,
      paid_at: null,
      version: 2,
      item_count: 1,
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) => callback({ tx: true }));
  });

  it('updates invoice lifecycle state through the service with no-store response headers', async () => {
    const response = await PATCH(
      createRequest({ action: 'issue', version: 1, occurred_at: '2026-06-19' }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(withOrgContextMock).toHaveBeenCalledWith(
      'org_1',
      expect.any(Function),
      expect.objectContaining({ isolationLevel: expect.any(String) }),
    );
    expect(transitionPharmacyInvoiceMock).toHaveBeenCalledWith(
      { tx: true },
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      'invoice_1',
      expect.objectContaining({
        action: 'issue',
        expectedVersion: 1,
        idempotencyKeyHash: expect.stringMatching(/^sha256:/),
        requestFingerprintHash: expect.stringMatching(/^sha256:/),
        occurredAt: new Date('2026-06-19T00:00:00.000Z'),
      }),
    );
    const body = await response.json();
    expect(body).toMatchObject({
      data: {
        id: 'invoice_1',
        status: 'issued',
        invoice_no: 'INV-202606-0001',
      },
    });
    expect(body).not.toHaveProperty('id');
  });

  it('requires a scheduled payment date before transaction side effects', async () => {
    const response = await PATCH(createRequest({ action: 'schedule_payment', version: 1 }));

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(transitionPharmacyInvoiceMock).not.toHaveBeenCalled();
  });

  it('maps missing and invalid transition service errors safely', async () => {
    transitionPharmacyInvoiceMock.mockRejectedValueOnce(
      new MockPharmacyInvoiceTransitionError('NOT_FOUND', '薬局間請求書が見つかりません'),
    );
    const missingResponse = await PATCH(createRequest({ action: 'issue', version: 1 }));
    expect(missingResponse.status).toBe(404);

    transitionPharmacyInvoiceMock.mockRejectedValueOnce(
      new MockPharmacyInvoiceTransitionError(
        'INVALID_TRANSITION',
        '現在の状態ではこの請求書操作を実行できません',
        { current_status: 'paid' },
      ),
    );
    const conflictResponse = await PATCH(createRequest({ action: 'cancel', version: 1 }));
    expect(conflictResponse.status).toBe(409);
    await expect(conflictResponse.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: { current_status: 'paid' },
    });
  });

  it('requires an idempotency key before transaction side effects', async () => {
    const response = await PATCH(createRequest({ action: 'issue', version: 1 }, null));

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(transitionPharmacyInvoiceMock).not.toHaveBeenCalled();
  });

  it('retries bounded serialization conflicts with the same transition input', async () => {
    withOrgContextMock
      .mockRejectedValueOnce({ code: 'P2034' })
      .mockImplementationOnce(async (_orgId, callback) => callback({ tx: true }));

    const response = await PATCH(createRequest({ action: 'reissue', version: 3, reason: '訂正' }));

    expect(response.status).toBe(200);
    expect(withOrgContextMock).toHaveBeenCalledTimes(2);
    expect(transitionPharmacyInvoiceMock).toHaveBeenCalledTimes(1);
  });

  it('returns a visible conflict after the bounded serialization retry limit', async () => {
    withOrgContextMock.mockRejectedValue({ code: 'P2034' });

    const response = await PATCH(createRequest({ action: 'reissue', version: 3 }));

    expect(response.status).toBe(409);
    expect(withOrgContextMock).toHaveBeenCalledTimes(3);
    await expect(response.json()).resolves.toMatchObject({ code: 'WORKFLOW_CONFLICT' });
  });
});
