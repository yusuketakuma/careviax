import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    membership: { findFirst: vi.fn() },
    formularyChangeRequest: { findFirst: vi.fn(), update: vi.fn() },
    pharmacyDrugStock: { upsert: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth/config', () => ({ auth: authMock }));
vi.mock('@/lib/db/client', () => ({ prisma: prismaMock }));

import { PATCH } from './route';

function createRequest(body: unknown) {
  return {
    url: 'http://localhost/api/pharmacy-drug-stock-requests/request_1',
    headers: {
      get: (key: string) => ({ 'x-org-id': 'org_1' }[key] ?? null),
    },
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

describe('/api/pharmacy-drug-stock-requests/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
    prismaMock.formularyChangeRequest.findFirst.mockResolvedValue({
      id: 'request_1',
      org_id: 'org_1',
      site_id: 'site_1',
      drug_master_id: 'drug_1',
      status: 'pending',
      requested_payload: {
        is_stocked: true,
        reorder_point: 10,
        preferred_generic_id: null,
        adoption_note: '承認反映',
      },
    });
    prismaMock.$transaction.mockImplementation((callback) =>
      callback({
        formularyChangeRequest: prismaMock.formularyChangeRequest,
        pharmacyDrugStock: prismaMock.pharmacyDrugStock,
        auditLog: prismaMock.auditLog,
      }),
    );
    prismaMock.pharmacyDrugStock.upsert.mockResolvedValue({ id: 'stock_1' });
    prismaMock.formularyChangeRequest.update.mockResolvedValue({
      id: 'request_1',
      status: 'approved',
    });
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit_1' });
  });

  it('approves a pending request and applies it to stock', async () => {
    const response = await PATCH(createRequest({ decision: 'approve' }), {
      params: Promise.resolve({ id: 'request_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      request: { id: 'request_1', status: 'approved' },
      stock: { id: 'stock_1' },
    });
    expect(prismaMock.pharmacyDrugStock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          org_id: 'org_1',
          site_id: 'site_1',
          drug_master_id: 'drug_1',
          is_stocked: true,
          adoption_source: 'approval',
        }),
        update: expect.objectContaining({
          is_stocked: true,
          reorder_point: 10,
          adoption_source: 'approval',
        }),
      }),
    );
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'pharmacy_drug_stock_change_approved',
          target_type: 'FormularyChangeRequest',
          target_id: 'request_1',
        }),
      }),
    );
  });

  it('rejects a pending request without mutating stock', async () => {
    prismaMock.formularyChangeRequest.update.mockResolvedValue({
      id: 'request_1',
      status: 'rejected',
    });

    const response = await PATCH(
      createRequest({ decision: 'reject', decision_note: '今回は見送り' }),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      request: { id: 'request_1', status: 'rejected' },
      stock: null,
    });
    expect(prismaMock.pharmacyDrugStock.upsert).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'pharmacy_drug_stock_change_rejected',
        }),
      }),
    );
  });

  it('rejects already processed requests before mutation', async () => {
    prismaMock.formularyChangeRequest.findFirst.mockResolvedValue({
      id: 'request_1',
      status: 'approved',
    });

    const response = await PATCH(createRequest({ decision: 'approve' }), {
      params: Promise.resolve({ id: 'request_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expect(prismaMock.pharmacyDrugStock.upsert).not.toHaveBeenCalled();
    expect(prismaMock.formularyChangeRequest.update).not.toHaveBeenCalled();
  });
});
