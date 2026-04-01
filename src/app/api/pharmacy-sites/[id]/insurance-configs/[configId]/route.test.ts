import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  insuranceConfigFindFirstMock,
  insuranceConfigFindManyMock,
  insuranceConfigUpdateMock,
  insuranceConfigDeleteMock,
  auditLogCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  insuranceConfigFindFirstMock: vi.fn(),
  insuranceConfigFindManyMock: vi.fn(),
  insuranceConfigUpdateMock: vi.fn(),
  insuranceConfigDeleteMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    pharmacySiteInsuranceConfig: {
      findFirst: insuranceConfigFindFirstMock,
      findMany: insuranceConfigFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { DELETE, PATCH } from './route';

describe('/api/pharmacy-sites/[id]/insurance-configs/[configId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      },
    });
    insuranceConfigFindFirstMock.mockResolvedValue({
      id: 'config_1',
      insurance_type: 'medical',
    });
    insuranceConfigFindManyMock.mockResolvedValue([]);
    insuranceConfigUpdateMock.mockResolvedValue({
      id: 'config_1',
      revision_code: '2024',
      revision_label: '更新版',
      insurance_type: 'medical',
    });
    insuranceConfigDeleteMock.mockResolvedValue({ id: 'config_1' });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        pharmacySiteInsuranceConfig: {
          update: insuranceConfigUpdateMock,
          delete: insuranceConfigDeleteMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('updates an insurance config', async () => {
    const response = (await PATCH({
      json: async () => ({
        revision_label: '更新版',
        effective_from: '2024-04-01',
        effective_to: null,
        config: { base_fee: 1 },
      }),
    } as NextRequest, {
      params: Promise.resolve({ id: 'site_1', configId: 'config_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(insuranceConfigUpdateMock).toHaveBeenCalledWith({
      where: { id: 'config_1' },
      data: {
        revision_label: '更新版',
        effective_from: new Date('2024-04-01'),
        effective_to: null,
        config: { base_fee: 1 },
      },
    });
  });

  it('returns 400 when the effective range overlaps another config', async () => {
    insuranceConfigFindFirstMock.mockResolvedValue({
      id: 'config_1',
      insurance_type: 'medical',
    });
    insuranceConfigFindManyMock.mockResolvedValue([
      {
        id: 'config_2',
        effective_from: new Date('2024-04-01T00:00:00.000Z'),
        effective_to: null,
      },
    ]);

    const response = (await PATCH({
      json: async () => ({
        revision_label: '更新版',
        effective_from: '2024-06-01',
        effective_to: null,
        config: { base_fee: 1 },
      }),
    } as NextRequest, {
      params: Promise.resolve({ id: 'site_1', configId: 'config_1' }),
    }))!;

    expect(response.status).toBe(400);
    expect(insuranceConfigUpdateMock).not.toHaveBeenCalled();
  });

  it('deletes an insurance config', async () => {
    const response = (await DELETE({} as NextRequest, {
      params: Promise.resolve({ id: 'site_1', configId: 'config_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(insuranceConfigDeleteMock).toHaveBeenCalledWith({
      where: { id: 'config_1' },
    });
  });
});
