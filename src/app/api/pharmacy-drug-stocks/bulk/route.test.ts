import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    membership: { findFirst: vi.fn() },
    pharmacySite: { findFirst: vi.fn() },
    drugMaster: { findMany: vi.fn() },
    pharmacyDrugStock: { upsert: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: prismaMock,
}));

import { POST } from './route';

function createRequest(body: unknown) {
  return {
    url: 'http://localhost/api/pharmacy-drug-stocks/bulk',
    headers: {
      get: (key: string) => ({ 'x-org-id': 'org_1' }[key] ?? null),
    },
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

describe('/api/pharmacy-drug-stocks/bulk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
    prismaMock.pharmacySite.findFirst.mockResolvedValue({ id: 'site_1', name: '本店' });
    prismaMock.$transaction.mockImplementation((callback) =>
      callback({
        pharmacyDrugStock: prismaMock.pharmacyDrugStock,
        auditLog: prismaMock.auditLog,
      }),
    );
    prismaMock.pharmacyDrugStock.upsert.mockResolvedValue({ id: 'stock_1' });
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit_1' });
  });

  it('imports CSV rows by YJ code and reports unmatched rows', async () => {
    prismaMock.drugMaster.findMany
      .mockResolvedValueOnce([
        { id: 'drug_1', yj_code: '123456789012', drug_name: 'アムロジピン錠5mg' },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const response = await POST(
      createRequest({
        site_id: 'site_1',
        csv: 'YJコード,医薬品名,採用,発注点\n123456789012,アムロジピン錠5mg,採用,10\n999999999999,不明薬,採用,5',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      importedCount: 1,
      unmatchedRows: [{ rowNumber: 3, yj_code: '999999999999' }],
    });
    expect(prismaMock.pharmacyDrugStock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          site_id: 'site_1',
          drug_master_id: 'drug_1',
          reorder_point: 10,
          adoption_source: 'csv',
        }),
      }),
    );
    expect(prismaMock.auditLog.create).toHaveBeenCalledOnce();
  });
});
