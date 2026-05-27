import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    membership: { findFirst: vi.fn() },
    pharmacySite: { findFirst: vi.fn() },
    drugMaster: { findFirst: vi.fn() },
    pharmacyDrugStock: { findFirst: vi.fn() },
    formularyChangeRequest: { create: vi.fn(), findMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth/config', () => ({ auth: authMock }));
vi.mock('@/lib/db/client', () => ({ prisma: prismaMock }));

import { GET, POST } from './route';

function createRequest(url: string, body?: unknown) {
  return {
    url,
    headers: {
      get: (key: string) => ({ 'x-org-id': 'org_1' }[key] ?? null),
    },
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

describe('/api/pharmacy-drug-stock-requests', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
    prismaMock.pharmacySite.findFirst.mockResolvedValue({ id: 'site_1', name: '本店' });
    prismaMock.drugMaster.findFirst.mockResolvedValue({
      id: 'drug_1',
      drug_name: 'ノルバスク錠5mg',
      generic_name: 'アムロジピン',
    });
    prismaMock.pharmacyDrugStock.findFirst.mockResolvedValue({
      id: 'stock_1',
      is_stocked: false,
      reorder_point: null,
      preferred_generic_id: null,
      adoption_note: null,
    });
    prismaMock.$transaction.mockImplementation((callback) =>
      callback({
        formularyChangeRequest: prismaMock.formularyChangeRequest,
        auditLog: prismaMock.auditLog,
      }),
    );
    prismaMock.formularyChangeRequest.create.mockResolvedValue({
      id: 'request_1',
      status: 'pending',
    });
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit_1' });
  });

  it('creates a pending formulary change request without mutating stock', async () => {
    const response = await POST(
      createRequest('http://localhost/api/pharmacy-drug-stock-requests', {
        site_id: 'site_1',
        drug_master_id: 'drug_1',
        action_type: 'adopt',
        requested_payload: {
          is_stocked: true,
          reorder_point: 10,
          preferred_generic_id: null,
          adoption_note: '委員会承認待ち',
        },
        reason: '新規採用候補',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      data: { id: 'request_1', status: 'pending' },
    });
    expect(prismaMock.formularyChangeRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          org_id: 'org_1',
          site_id: 'site_1',
          drug_master_id: 'drug_1',
          requested_by_id: 'user_1',
          action_type: 'adopt',
          requested_payload: expect.objectContaining({ is_stocked: true, reorder_point: 10 }),
          current_snapshot: expect.objectContaining({ id: 'stock_1' }),
        }),
      }),
    );
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'pharmacy_drug_stock_change_requested',
          target_type: 'FormularyChangeRequest',
        }),
      }),
    );
  });

  it('lists pending requests scoped by site after validating same org site', async () => {
    prismaMock.formularyChangeRequest.findMany.mockResolvedValue([
      { id: 'request_1', status: 'pending' },
    ]);

    const response = await GET(
      createRequest('http://localhost/api/pharmacy-drug-stock-requests?site_id=site_1'),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'request_1', status: 'pending' }],
    });
    expect(prismaMock.formularyChangeRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ org_id: 'org_1', site_id: 'site_1', status: 'pending' }),
      }),
    );
  });
});
