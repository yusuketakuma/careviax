import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    membership: { findFirst: vi.fn() },
    formularyTemplate: { delete: vi.fn(), findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth/config', () => ({ auth: authMock }));
vi.mock('@/lib/db/client', () => ({ prisma: prismaMock }));

import { DELETE } from './route';

function createRequest() {
  return {
    url: 'http://localhost/api/pharmacy-drug-stock-templates/template_1',
    headers: { get: (key: string) => ({ 'x-org-id': 'org_1' }[key] ?? null) },
  } as unknown as NextRequest;
}

describe('/api/pharmacy-drug-stock-templates/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
    prismaMock.formularyTemplate.findFirst.mockResolvedValue({
      id: 'template_1',
      name: '在宅内科 標準セット',
      item_count: 12,
      source_site_id: 'site_1',
    });
    prismaMock.formularyTemplate.delete.mockResolvedValue({ id: 'template_1' });
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit_1' });
    prismaMock.$transaction.mockImplementation((callback) =>
      callback({
        formularyTemplate: prismaMock.formularyTemplate,
        auditLog: prismaMock.auditLog,
      }),
    );
  });

  it('deletes a same-org formulary template and records an audit log', async () => {
    const response = await DELETE(createRequest(), {
      params: Promise.resolve({ id: 'template_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      deleted: true,
      data: { id: 'template_1', name: '在宅内科 標準セット' },
    });
    expect(prismaMock.formularyTemplate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'template_1', org_id: 'org_1' },
      }),
    );
    expect(prismaMock.formularyTemplate.delete).toHaveBeenCalledWith({
      where: { id: 'template_1' },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          org_id: 'org_1',
          actor_id: 'user_1',
          action: 'formulary_template_deleted',
          target_type: 'FormularyTemplate',
          target_id: 'template_1',
          changes: {
            template_name: '在宅内科 標準セット',
            item_count: 12,
            source_site_id: 'site_1',
          },
        }),
      }),
    );
  });

  it('does not delete another org template', async () => {
    prismaMock.formularyTemplate.findFirst.mockResolvedValue(null);

    const response = await DELETE(createRequest(), {
      params: Promise.resolve({ id: 'template_2' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(prismaMock.formularyTemplate.delete).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });
});
