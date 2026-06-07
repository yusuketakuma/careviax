import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  withOrgContextMock,
  pcaPumpFindFirstMock,
  pcaPumpUpdateMock,
  auditLogCreateMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  pcaPumpFindFirstMock: vi.fn(),
  pcaPumpUpdateMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    pcaPump: {
      findFirst: pcaPumpFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { PATCH } from './route';

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/pca-pumps/pump_1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/pca-pumps/[id] PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: { orgId: 'org_1', userId: 'user_1', role: 'admin' },
    });
    pcaPumpFindFirstMock.mockResolvedValue({
      id: 'pump_1',
      _count: { rentals: 0 },
    });
    pcaPumpUpdateMock.mockResolvedValue({
      id: 'pump_1',
      asset_code: 'PCA-001',
      serial_number: null,
      model_name: 'CADD Legacy PCA',
      manufacturer: null,
      status: 'maintenance',
      maintenance_due_at: null,
      notes: null,
      created_at: new Date('2026-06-10T00:00:00.000Z'),
      updated_at: new Date('2026-06-10T00:00:00.000Z'),
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        pcaPump: {
          update: pcaPumpUpdateMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('rejects setting a pump with open rentals to a non-rented status', async () => {
    pcaPumpFindFirstMock.mockResolvedValue({
      id: 'pump_1',
      _count: { rentals: 1 },
    });

    const response = await PATCH(createRequest({ status: 'available' }), {
      params: Promise.resolve({ id: 'pump_1' }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '未完了の貸出があるPCAポンプは利用可能・点検・退役へ変更できません',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pcaPumpUpdateMock).not.toHaveBeenCalled();
  });

  it('allows maintenance status when there are no open rentals', async () => {
    const response = await PATCH(createRequest({ status: 'maintenance' }), {
      params: Promise.resolve({ id: 'pump_1' }),
    });

    expect(response.status).toBe(200);
    expect(pcaPumpFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'pump_1', org_id: 'org_1' },
      select: {
        id: true,
        _count: {
          select: {
            rentals: {
              where: { status: { in: ['scheduled', 'active', 'overdue'] } },
            },
          },
        },
      },
    });
    expect(pcaPumpUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'maintenance' }),
      }),
    );
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'pca_pump_updated',
        target_type: 'PcaPump',
        target_id: 'pump_1',
        changes: { status: 'maintenance' },
      }),
    });
  });
});
