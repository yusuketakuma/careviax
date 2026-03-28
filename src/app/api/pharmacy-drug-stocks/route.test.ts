import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    membership: { findFirst: vi.fn() },
    pharmacySite: { findFirst: vi.fn() },
    drugMaster: { findFirst: vi.fn() },
    pharmacyDrugStock: { findFirst: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
  },
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: prismaMock,
}));

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

describe('/api/pharmacy-drug-stocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
    prismaMock.pharmacySite.findFirst.mockResolvedValue({ id: 'site_1', name: '本店' });
  });

  it('returns the current stock config for a selected drug and site', async () => {
    prismaMock.pharmacyDrugStock.findFirst.mockResolvedValue({
      id: 'stock_1',
      site_id: 'site_1',
      drug_master_id: 'drug_1',
      is_stocked: true,
      stock_qty: null,
      reorder_point: null,
      preferred_generic_id: 'generic_1',
      updated_at: new Date('2026-03-28T00:00:00Z'),
      preferred_generic: {
        id: 'generic_1',
        drug_name: 'アムロジピン錠5mg「GE」',
        yj_code: '123456789012',
      },
    });

    const response = await GET(
      createRequest('http://localhost/api/pharmacy-drug-stocks?site_id=site_1&drug_master_id=drug_1'),
      { params: Promise.resolve({}) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'stock_1',
        is_stocked: true,
        preferred_generic_id: 'generic_1',
      },
      site: {
        id: 'site_1',
      },
    });
  });

  it('upserts stock adoption with a preferred generic', async () => {
    prismaMock.drugMaster.findFirst
      .mockResolvedValueOnce({
        id: 'drug_1',
        drug_name: 'ノルバスク錠5mg',
        generic_name: 'アムロジピンベシル酸塩錠',
        is_generic: false,
      })
      .mockResolvedValueOnce({
        id: 'generic_1',
        drug_name: 'アムロジピン錠5mg「GE」',
        yj_code: '123456789012',
        is_generic: true,
        generic_name: 'アムロジピンベシル酸塩錠',
      });
    prismaMock.pharmacyDrugStock.upsert.mockResolvedValue({
      id: 'stock_1',
      site_id: 'site_1',
      drug_master_id: 'drug_1',
      is_stocked: true,
      stock_qty: null,
      reorder_point: null,
      preferred_generic_id: 'generic_1',
      updated_at: new Date('2026-03-28T00:00:00Z'),
      preferred_generic: {
        id: 'generic_1',
        drug_name: 'アムロジピン錠5mg「GE」',
        yj_code: '123456789012',
      },
    });

    const response = await POST(
      createRequest('http://localhost/api/pharmacy-drug-stocks', {
        site_id: 'site_1',
        drug_master_id: 'drug_1',
        is_stocked: true,
        preferred_generic_id: 'generic_1',
      }),
      { params: Promise.resolve({}) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(prismaMock.pharmacyDrugStock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          org_id: 'org_1',
          site_id: 'site_1',
          drug_master_id: 'drug_1',
          preferred_generic_id: 'generic_1',
        }),
        update: expect.objectContaining({
          is_stocked: true,
          preferred_generic_id: 'generic_1',
        }),
      })
    );
  });
});
