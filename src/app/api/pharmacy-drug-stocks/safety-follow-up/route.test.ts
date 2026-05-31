import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    membership: { findFirst: vi.fn() },
    pharmacySite: { findFirst: vi.fn() },
    pharmacyDrugStock: { count: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
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
  return new NextRequest('http://localhost/api/pharmacy-drug-stocks/safety-follow-up', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

describe('/api/pharmacy-drug-stocks/safety-follow-up', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
    prismaMock.pharmacySite.findFirst.mockResolvedValue({ id: 'site_1', name: '本店' });
    prismaMock.pharmacyDrugStock.count.mockResolvedValue(0);
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit_1' });
    prismaMock.$transaction.mockImplementation((callback) =>
      callback({
        pharmacyDrugStock: prismaMock.pharmacyDrugStock,
        auditLog: prismaMock.auditLog,
      }),
    );
  });

  it('creates needs-review follow-ups for high-risk stocked drugs without overwriting unresolved rows', async () => {
    prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([
      { id: 'stock_1', drug_master_id: 'drug_1' },
      { id: 'stock_2', drug_master_id: 'drug_2' },
    ]);
    prismaMock.pharmacyDrugStock.count.mockResolvedValue(1);
    prismaMock.pharmacyDrugStock.updateMany.mockResolvedValue({ count: 2 });

    const response = await POST(
      createRequest({
        site_id: 'site_1',
        queue: 'high_risk',
        due_in_days: 14,
        reason: 'ハイリスク薬の採用品定期確認',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      site: { id: 'site_1' },
      queue: 'high_risk',
      matchedCount: 2,
      updatedCount: 2,
      skippedUnresolvedCount: 1,
      dryRun: false,
    });
    expect(prismaMock.pharmacyDrugStock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          site_id: 'site_1',
          is_stocked: true,
          OR: [{ follow_up_status: null }, { follow_up_status: 'active' }],
          drug_master: { is_high_risk: true },
        }),
        take: 1000,
      }),
    );
    expect(prismaMock.pharmacyDrugStock.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['stock_1', 'stock_2'] }, org_id: 'org_1' },
        data: expect.objectContaining({
          follow_up_status: 'needs_review',
          follow_up_reason: 'ハイリスク薬の採用品定期確認',
          follow_up_resolved_at: null,
        }),
      }),
    );
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'pharmacy_drug_stock_safety_follow_up_created',
          target_id: 'site_1',
          changes: expect.objectContaining({
            queue: 'high_risk',
            updated_count: 2,
            skipped_unresolved_count: 1,
            drug_master_ids: ['drug_1', 'drug_2'],
          }),
        }),
      }),
    );
  });

  it('previews controlled-drug follow-up targets without mutation on dry run', async () => {
    prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([
      { id: 'stock_1', drug_master_id: 'drug_1' },
    ]);

    const response = await POST(
      createRequest({ site_id: 'site_1', queue: 'controlled', dry_run: true }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      queue: 'controlled',
      matchedCount: 1,
      updatedCount: 0,
      dryRun: true,
    });
    expect(prismaMock.pharmacyDrugStock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          drug_master: { OR: [{ is_narcotic: true }, { is_psychotropic: true }] },
        }),
      }),
    );
    expect(prismaMock.pharmacyDrugStock.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects another org site before looking up stocks', async () => {
    prismaMock.pharmacySite.findFirst.mockResolvedValue(null);

    const response = await POST(createRequest({ site_id: 'other_site' }), {
      params: Promise.resolve({}),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });
});
