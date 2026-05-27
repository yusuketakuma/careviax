import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    membership: { findFirst: vi.fn() },
    pharmacySite: { findFirst: vi.fn() },
    pharmacyDrugStock: { findMany: vi.fn() },
    formularyTemplate: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
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
    headers: { get: (key: string) => ({ 'x-org-id': 'org_1' }[key] ?? null) },
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

describe('/api/pharmacy-drug-stock-templates', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
    prismaMock.pharmacySite.findFirst.mockResolvedValue({ id: 'site_1', name: '本店' });
    prismaMock.pharmacyDrugStock.findMany.mockResolvedValue([
      {
        drug_master_id: 'drug_1',
        reorder_point: 10,
        preferred_generic_id: null,
        adoption_note: '標準採用',
      },
    ]);
    prismaMock.$transaction.mockImplementation((callback) =>
      callback({
        formularyTemplate: prismaMock.formularyTemplate,
        auditLog: prismaMock.auditLog,
      }),
    );
    prismaMock.formularyTemplate.create.mockResolvedValue({
      id: 'template_1',
      name: '在宅内科 標準セット',
      item_count: 1,
    });
    prismaMock.formularyTemplate.findFirst.mockResolvedValue(null);
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit_1' });
  });

  it('lists formulary templates for the current org with optional search and limit', async () => {
    prismaMock.formularyTemplate.findMany.mockResolvedValue([
      { id: 'template_1', name: '在宅内科 標準セット', item_count: 12 },
    ]);

    const response = await GET(
      createRequest('http://localhost/api/pharmacy-drug-stock-templates?q=%E5%9C%A8%E5%AE%85&limit=10'),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'template_1', item_count: 12 }],
    });
    expect(prismaMock.formularyTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          OR: [
            { name: { contains: '在宅' } },
            { description: { contains: '在宅' } },
          ],
        },
        take: 10,
      }),
    );
  });

  it('creates a template from stocked drugs at a same-org site', async () => {
    const response = await POST(
      createRequest('http://localhost/api/pharmacy-drug-stock-templates', {
        name: '在宅内科 標準セット',
        source_site_id: 'site_1',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      data: { id: 'template_1', item_count: 1 },
    });
    expect(prismaMock.formularyTemplate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          org_id: 'org_1',
          name: '在宅内科 標準セット',
          source_site_id: 'site_1',
          created_by_id: 'user_1',
          item_count: 1,
          items: [{ drug_master_id: 'drug_1', reorder_point: 10, preferred_generic_id: null, adoption_note: '標準採用' }],
        }),
      }),
    );
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'formulary_template_created',
          target_type: 'FormularyTemplate',
        }),
      }),
    );
  });

  it('rejects duplicate template names in the same org before reading source stocks', async () => {
    prismaMock.formularyTemplate.findFirst.mockResolvedValue({
      id: 'template_existing',
      name: '在宅内科 標準セット',
    });

    const response = await POST(
      createRequest('http://localhost/api/pharmacy-drug-stock-templates', {
        name: '在宅内科 標準セット',
        source_site_id: 'site_1',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '同じ名前の採用品テンプレートがすでに存在します',
      details: {
        template_id: 'template_existing',
        name: '在宅内科 標準セット',
      },
    });
    expect(prismaMock.pharmacyDrugStock.findMany).not.toHaveBeenCalled();
    expect(prismaMock.formularyTemplate.create).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });
});
