import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  withOrgContextMock,
  findFirstMock,
  updateManyMock,
  findUniqueMock,
  auditLogCreateMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  findFirstMock: vi.fn(),
  updateManyMock: vi.fn(),
  findUniqueMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { PATCH } from './route';

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/billing-candidates/candidate_1/collection', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
    body: JSON.stringify(body),
  });
}

describe('/api/billing-candidates/[id]/collection PATCH', () => {
  const updatedAt = new Date('2026-06-01T00:00:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'admin',
      },
    });
    findFirstMock.mockResolvedValue({
      id: 'candidate_1',
      status: 'confirmed',
      calculation_breakdown: { amount_yen: 3240 },
      updated_at: updatedAt,
    });
    updateManyMock.mockResolvedValue({ count: 1 });
    findUniqueMock.mockResolvedValue({
      id: 'candidate_1',
      calculation_breakdown: {
        amount_yen: 3240,
        collection: {
          status: 'partial',
          billed_amount: 3240,
          collected_amount: 2160,
          unpaid_amount: 1080,
        },
      },
    });
    auditLogCreateMock.mockResolvedValue({});
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        billingCandidate: {
          findFirst: findFirstMock,
          updateMany: updateManyMock,
          findUnique: findUniqueMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('records collection metadata in calculation_breakdown and writes an audit log', async () => {
    const response = await PATCH(
      createRequest({
        status: 'partial',
        billed_amount: 3240,
        collected_amount: 2160,
        payment_method: 'cash',
        payer_name: '長女',
        billed_at: '2026-06-15T00:00:00.000Z',
        scheduled_collection_at: '2026-06-25T00:00:00.000Z',
        collected_at: '2026-06-16T00:00:00.000Z',
        receipt_number: 'R20260616-001',
        unpaid_reason: '次回訪問時に残額集金',
      }),
      { params: Promise.resolve({ id: ' candidate_1 ' }) },
    );

    expect(response.status).toBe(200);
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(Object), {
      permission: 'canManageBilling',
      message: '集金記録の更新権限がありません',
    });
    expect(updateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'candidate_1',
        org_id: 'org_1',
        updated_at: updatedAt,
      },
      data: {
        calculation_breakdown: expect.objectContaining({
          amount_yen: 3240,
          collection: expect.objectContaining({
            status: 'partial',
            billed_amount: 3240,
            collected_amount: 2160,
            unpaid_amount: 1080,
            payment_method: 'cash',
            payer_name: '長女',
            scheduled_collection_at: '2026-06-25T00:00:00.000Z',
            receipt_number: 'R20260616-001',
            updated_by: 'user_1',
          }),
        }),
      },
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          org_id: 'org_1',
          actor_id: 'user_1',
          action: 'billing_collection_updated',
          target_type: 'BillingCandidate',
          target_id: 'candidate_1',
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: { id: 'candidate_1' },
    });
  });

  it('rejects collected amounts greater than billed amounts', async () => {
    const response = await PATCH(
      createRequest({
        status: 'partial',
        billed_amount: 1000,
        collected_amount: 2000,
      }),
      { params: Promise.resolve({ id: 'candidate_1' }) },
    );

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects collected status when the payment is incomplete', async () => {
    const response = await PATCH(
      createRequest({
        status: 'collected',
        billed_amount: 3240,
        collected_amount: 2160,
        collected_at: '2026-06-16T00:00:00.000Z',
      }),
      { params: Promise.resolve({ id: 'candidate_1' }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      details: {
        collected_amount: expect.arrayContaining(['集金済では入金額を請求額と一致させてください']),
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects collected status without a collected timestamp', async () => {
    const response = await PATCH(
      createRequest({
        status: 'collected',
        billed_amount: 3240,
        collected_amount: 3240,
      }),
      { params: Promise.resolve({ id: 'candidate_1' }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      details: { collected_at: expect.arrayContaining(['集金済では入金日時が必須です']) },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects partial status when the amount is fully collected', async () => {
    const response = await PATCH(
      createRequest({
        status: 'partial',
        billed_amount: 3240,
        collected_amount: 3240,
        collected_at: '2026-06-16T00:00:00.000Z',
      }),
      { params: Promise.resolve({ id: 'candidate_1' }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      details: {
        collected_amount: expect.arrayContaining(['一部入金では入金額を請求額未満にしてください']),
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects scheduled collection without a scheduled date', async () => {
    const response = await PATCH(
      createRequest({
        status: 'scheduled',
        billed_amount: 3240,
        collected_amount: 0,
      }),
      { params: Promise.resolve({ id: 'candidate_1' }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      details: { scheduled_collection_at: expect.arrayContaining(['集金予定日は必須です']) },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the candidate is missing', async () => {
    findFirstMock.mockResolvedValue(null);

    const response = await PATCH(createRequest({ status: 'billed', billed_amount: 3240 }), {
      params: Promise.resolve({ id: 'candidate_1' }),
    });

    expect(response.status).toBe(404);
    expect(updateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns 409 when the candidate changed after it was read', async () => {
    updateManyMock.mockResolvedValue({ count: 0 });

    const response = await PATCH(createRequest({ status: 'billed', billed_amount: 3240 }), {
      params: Promise.resolve({ id: 'candidate_1' }),
    });

    expect(response.status).toBe(409);
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });
});
