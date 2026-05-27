import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    membership: { findFirst: vi.fn() },
    pharmacySite: { findFirst: vi.fn() },
    pharmacyDrugStock: { findMany: vi.fn(), upsert: vi.fn() },
    formularyTemplate: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth/config', () => ({ auth: authMock }));
vi.mock('@/lib/db/client', () => ({ prisma: prismaMock }));

import { POST } from './route';

function createRequest(body: unknown) {
  return {
    url: 'http://localhost/api/pharmacy-drug-stock-templates/template_1/apply',
    headers: { get: (key: string) => ({ 'x-org-id': 'org_1' }[key] ?? null) },
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

describe('/api/pharmacy-drug-stock-templates/[id]/apply', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
    prismaMock.pharmacySite.findFirst.mockResolvedValue({ id: 'site_2', name: '支店' });
    prismaMock.formularyTemplate.findFirst.mockResolvedValue({
      id: 'template_1',
      name: '在宅内科 標準セット',
      items: [
        {
          drug_master_id: 'drug_new',
          reorder_point: 10,
          preferred_generic_id: null,
          adoption_note: '標準採用',
        },
        {
          drug_master_id: 'drug_existing',
          reorder_point: 5,
          preferred_generic_id: null,
          adoption_note: null,
        },
      ],
    });
    prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([{ drug_master_id: 'drug_existing' }]);
    prismaMock.$transaction.mockImplementation((callback) =>
      callback({
        pharmacyDrugStock: prismaMock.pharmacyDrugStock,
        auditLog: prismaMock.auditLog,
      }),
    );
    prismaMock.pharmacyDrugStock.upsert.mockResolvedValue({ id: 'stock_1' });
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit_1' });
  });

  it('applies a formulary template to a same-org site and skips existing rows by default', async () => {
    const response = await POST(
      createRequest({ target_site_id: 'site_2' }),
      { params: Promise.resolve({ id: 'template_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      itemCount: 2,
      appliedCount: 1,
      skippedCount: 1,
      overwrite: false,
    });
    expect(prismaMock.pharmacyDrugStock.upsert).toHaveBeenCalledOnce();
    expect(prismaMock.pharmacyDrugStock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          site_id: 'site_2',
          drug_master_id: 'drug_new',
          adoption_source: 'template',
        }),
      }),
    );
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'formulary_template_applied',
          target_id: 'site_2',
          changes: expect.objectContaining({
            template_id: 'template_1',
            applied_count: 1,
            skipped_count: 1,
          }),
        }),
      }),
    );
  });
});
