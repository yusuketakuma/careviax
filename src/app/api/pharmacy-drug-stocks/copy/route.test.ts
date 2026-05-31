import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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
  return new NextRequest('http://localhost/api/pharmacy-drug-stocks/copy', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
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
          drug_master: {
            id: 'drug_new',
            yj_code: '111111111111',
            drug_name: '新規採用品',
          },
        },
        {
          drug_master_id: 'drug_existing',
          reorder_point: 5,
          preferred_generic_id: null,
          adoption_note: null,
          drug_master: {
            id: 'drug_existing',
            yj_code: '222222222222',
            drug_name: '既存採用品',
          },
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
      dryRun: false,
      preview: {
        summary: {
          source_count: 2,
          create_count: 1,
          update_count: 0,
          skip_existing_count: 1,
          apply_count: 1,
        },
      },
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
          drug_master: {
            id: 'drug_existing',
            yj_code: '222222222222',
            drug_name: '既存採用品',
          },
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
      preview: {
        summary: {
          create_count: 0,
          update_count: 1,
          skip_existing_count: 0,
          apply_count: 1,
        },
      },
    });
    expect(prismaMock.pharmacyDrugStock.upsert).toHaveBeenCalledOnce();
  });

  it('previews create/update/skip operations without writing when dry_run is requested', async () => {
    prismaMock.pharmacyDrugStock.findMany
      .mockResolvedValueOnce([
        {
          drug_master_id: 'drug_new',
          reorder_point: 10,
          preferred_generic_id: null,
          adoption_note: null,
          drug_master: {
            id: 'drug_new',
            yj_code: '111111111111',
            drug_name: '新規採用品',
          },
        },
        {
          drug_master_id: 'drug_existing',
          reorder_point: 5,
          preferred_generic_id: null,
          adoption_note: null,
          drug_master: {
            id: 'drug_existing',
            yj_code: '222222222222',
            drug_name: '既存採用品',
          },
        },
      ])
      .mockResolvedValueOnce([{ drug_master_id: 'drug_existing' }]);

    const response = await POST(
      createRequest({
        source_site_id: 'source_site',
        target_site_id: 'target_site',
        dry_run: true,
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      copiedCount: 0,
      skippedCount: 1,
      dryRun: true,
      preview: {
        summary: {
          source_count: 2,
          create_count: 1,
          update_count: 0,
          skip_existing_count: 1,
          apply_count: 1,
        },
        rows: [
          { action: 'create', drug_master: { drug_name: '新規採用品' } },
          { action: 'skip_existing', drug_master: { drug_name: '既存採用品' } },
        ],
      },
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.pharmacyDrugStock.upsert).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
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
