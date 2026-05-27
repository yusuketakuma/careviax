import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    membership: { findFirst: vi.fn() },
    pharmacySite: { findMany: vi.fn() },
    pharmacyDrugStock: { findMany: vi.fn(), upsert: vi.fn() },
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
    url: 'http://localhost/api/pharmacy-drug-stocks/copy',
    headers: {
      get: (key: string) => ({ 'x-org-id': 'org_1' }[key] ?? null),
    },
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

describe('/api/pharmacy-drug-stocks/copy', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
    prismaMock.pharmacySite.findMany.mockResolvedValue([
      { id: 'source_site', name: '本店' },
      { id: 'target_site', name: '支店' },
    ]);
    prismaMock.$transaction.mockImplementation((callback) =>
      callback({
        pharmacyDrugStock: prismaMock.pharmacyDrugStock,
        auditLog: prismaMock.auditLog,
      }),
    );
    prismaMock.pharmacyDrugStock.upsert.mockResolvedValue({ id: 'stock_1' });
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit_1' });
  });

  it('copies source stocked formulary rows to another org site and skips existing target rows by default', async () => {
    prismaMock.pharmacyDrugStock.findMany
      .mockResolvedValueOnce([
        {
          drug_master_id: 'drug_new',
          reorder_point: 10,
          preferred_generic_id: 'generic_1',
          adoption_note: '標準採用',
        },
        {
          drug_master_id: 'drug_existing',
          reorder_point: 5,
          preferred_generic_id: null,
          adoption_note: null,
        },
      ])
      .mockResolvedValueOnce([{ drug_master_id: 'drug_existing' }]);

    const response = await POST(
      createRequest({
        source_site_id: 'source_site',
        target_site_id: 'target_site',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      sourceCount: 2,
      copiedCount: 1,
      skippedCount: 1,
      overwrite: false,
    });
    expect(prismaMock.pharmacyDrugStock.upsert).toHaveBeenCalledOnce();
    expect(prismaMock.pharmacyDrugStock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          site_id: 'target_site',
          drug_master_id: 'drug_new',
          adoption_source: 'site_copy',
          preferred_generic_id: 'generic_1',
        }),
      }),
    );
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'pharmacy_drug_stock_site_copied',
          target_id: 'target_site',
          changes: expect.objectContaining({
            source_site_id: 'source_site',
            target_site_id: 'target_site',
            source_count: 2,
            copied_count: 1,
            skipped_count: 1,
            overwrite: false,
          }),
        }),
      }),
    );
  });

  it('overwrites existing target rows when requested', async () => {
    prismaMock.pharmacyDrugStock.findMany
      .mockResolvedValueOnce([
        {
          drug_master_id: 'drug_existing',
          reorder_point: 5,
          preferred_generic_id: null,
          adoption_note: null,
        },
      ])
      .mockResolvedValueOnce([{ drug_master_id: 'drug_existing' }]);

    const response = await POST(
      createRequest({
        source_site_id: 'source_site',
        target_site_id: 'target_site',
        overwrite: true,
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      sourceCount: 1,
      copiedCount: 1,
      skippedCount: 0,
      overwrite: true,
    });
    expect(prismaMock.pharmacyDrugStock.upsert).toHaveBeenCalledOnce();
  });

  it('rejects copying to the same site before querying sites', async () => {
    const response = await POST(
      createRequest({
        source_site_id: 'source_site',
        target_site_id: 'source_site',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(prismaMock.pharmacySite.findMany).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalled();
  });

  it('rejects cross-org or missing sites before querying stock rows', async () => {
    prismaMock.pharmacySite.findMany.mockResolvedValue([{ id: 'source_site', name: '本店' }]);

    const response = await POST(
      createRequest({
        source_site_id: 'source_site',
        target_site_id: 'target_site',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalled();
  });
});
