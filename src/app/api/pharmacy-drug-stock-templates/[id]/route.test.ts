import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';

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
  return new NextRequest('http://localhost/api/pharmacy-drug-stock-templates/template_1', {
    headers: { 'x-org-id': 'org_1' },
  });
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
      org_id: 'org_1',
      created_by_id: 'user_1',
      items: [{ drug_master_id: 'drug_1' }],
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
    expectNoStore(response);
    const payload = await response.json();
    expect(Object.keys(payload).sort()).toEqual(['data', 'meta']);
    expect(payload.data).toEqual({
      id: 'template_1',
      name: '在宅内科 標準セット',
      item_count: 12,
      source_site_id: 'site_1',
    });
    expect(payload.meta).toEqual({ deleted: true });
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
    expectNoStore(response);
    expect(prismaMock.formularyTemplate.delete).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });
});
