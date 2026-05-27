import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    membership: { findFirst: vi.fn() },
    pharmacySite: { findFirst: vi.fn() },
    pharmacyDrugStock: { findUnique: vi.fn() },
    auditLog: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: prismaMock,
}));

import { GET } from './route';

function createRequest(
  url = 'http://localhost/api/pharmacy-drug-stocks/history?site_id=site_1&drug_master_id=drug_1',
) {
  return {
    url,
    headers: {
      get: (key: string) => ({ 'x-org-id': 'org_1' }[key] ?? null),
    },
  } as unknown as NextRequest;
}

describe('/api/pharmacy-drug-stocks/history', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
    prismaMock.pharmacySite.findFirst.mockResolvedValue({ id: 'site_1', name: '本店' });
    prismaMock.pharmacyDrugStock.findUnique.mockResolvedValue({
      id: 'stock_1',
      drug_master_id: 'drug_1',
    });
  });

  it('returns stock-specific audit logs and matching site review logs', async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([
      {
        id: 'audit_stock',
        actor_id: 'user_1',
        action: 'pharmacy_drug_stock_updated',
        target_type: 'PharmacyDrugStock',
        target_id: 'stock_1',
        changes: { drug_master_id: 'drug_1' },
        created_at: new Date('2026-05-27T00:00:00.000Z'),
      },
      {
        id: 'audit_review_match',
        actor_id: 'user_1',
        action: 'pharmacy_drug_stock_reviewed',
        target_type: 'PharmacySite',
        target_id: 'site_1',
        changes: { drug_master_ids: ['drug_1', 'drug_2'] },
        created_at: new Date('2026-05-26T00:00:00.000Z'),
      },
      {
        id: 'audit_review_other',
        actor_id: 'user_1',
        action: 'pharmacy_drug_stock_reviewed',
        target_type: 'PharmacySite',
        target_id: 'site_1',
        changes: { drug_master_ids: ['drug_other'] },
        created_at: new Date('2026-05-25T00:00:00.000Z'),
      },
    ]);

    const response = await GET(createRequest(), { params: Promise.resolve({}) });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      site: { id: 'site_1' },
      stock: { id: 'stock_1', drug_master_id: 'drug_1' },
      data: [
        { id: 'audit_stock', action: 'pharmacy_drug_stock_updated' },
        { id: 'audit_review_match', action: 'pharmacy_drug_stock_reviewed' },
      ],
    });
    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          OR: expect.arrayContaining([
            { target_type: 'PharmacyDrugStock', target_id: 'stock_1' },
            {
              target_type: 'PharmacySite',
              target_id: 'site_1',
              action: 'pharmacy_drug_stock_reviewed',
            },
          ]),
        }),
      }),
    );
  });

  it('returns an empty history when the drug is not configured for the site', async () => {
    prismaMock.pharmacyDrugStock.findUnique.mockResolvedValue(null);

    const response = await GET(createRequest(), { params: Promise.resolve({}) });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      stock: null,
      data: [],
    });
    expect(prismaMock.auditLog.findMany).not.toHaveBeenCalled();
  });

  it('rejects another org site before querying stock history', async () => {
    prismaMock.pharmacySite.findFirst.mockResolvedValue(null);

    const response = await GET(createRequest(), { params: Promise.resolve({}) });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(prismaMock.pharmacyDrugStock.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.findMany).not.toHaveBeenCalled();
  });
});
