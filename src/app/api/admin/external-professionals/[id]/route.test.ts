import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  externalProfessionalFindFirstMock,
  externalProfessionalUpdateMock,
  externalProfessionalDeleteMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  externalProfessionalFindFirstMock: vi.fn(),
  externalProfessionalUpdateMock: vi.fn(),
  externalProfessionalDeleteMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'admin' }, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    externalProfessional: {
      findFirst: externalProfessionalFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { DELETE, PATCH } from './route';

describe('/api/admin/external-professionals/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    externalProfessionalFindFirstMock.mockResolvedValue({ id: 'external_1' });
    externalProfessionalUpdateMock.mockResolvedValue({
      id: 'external_1',
      profession_type: 'nurse',
      name: '訪問 看護',
      organization_name: 'あおば訪看',
      department: null,
      phone: '03-1111-2222',
      email: null,
      fax: null,
      address: null,
      notes: null,
      created_at: new Date('2026-03-28T00:00:00.000Z'),
      updated_at: new Date('2026-03-28T00:00:00.000Z'),
    });
    externalProfessionalDeleteMock.mockResolvedValue({ id: 'external_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        externalProfessional: {
          update: externalProfessionalUpdateMock,
          delete: externalProfessionalDeleteMock,
        },
      }),
    );
  });

  it('updates an external professional row', async () => {
    const response = (await PATCH({
      json: async () => ({
        profession_type: 'nurse',
        name: '訪問 看護',
        organization_name: 'あおば訪看',
        phone: '03-1111-2222',
      }),
    } as NextRequest, {
      params: Promise.resolve({ id: 'external_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(externalProfessionalUpdateMock).toHaveBeenCalledWith({
      where: { id: 'external_1' },
      data: expect.objectContaining({
        profession_type: 'nurse',
        name: '訪問 看護',
        organization_name: 'あおば訪看',
        phone: '03-1111-2222',
      }),
    });
  });

  it('deletes an external professional row', async () => {
    const response = (await DELETE({} as NextRequest, {
      params: Promise.resolve({ id: 'external_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(externalProfessionalDeleteMock).toHaveBeenCalledWith({
      where: { id: 'external_1' },
    });
  });
});
