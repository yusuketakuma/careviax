import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  externalProfessionalFindManyMock,
  externalProfessionalCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  externalProfessionalFindManyMock: vi.fn(),
  externalProfessionalCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: (req: NextRequest & { orgId: string; userId: string; role: string; nextUrl: URL }) => Promise<Response>) =>
    handler,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    externalProfessional: {
      findMany: externalProfessionalFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

describe('/api/admin/external-professionals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    externalProfessionalFindManyMock.mockResolvedValue([
      {
        id: 'external_1',
        profession_type: 'nurse',
        name: '訪問 看護',
        organization_name: 'あおば訪看',
        department: null,
        phone: null,
        email: null,
        fax: null,
        address: null,
        notes: null,
        created_at: new Date('2026-03-28T00:00:00.000Z'),
        updated_at: new Date('2026-03-28T00:00:00.000Z'),
      },
    ]);
    externalProfessionalCreateMock.mockResolvedValue({
      id: 'external_2',
      profession_type: 'care_manager',
      name: '山田 ケアマネ',
      organization_name: '居宅支援A',
      department: null,
      phone: '03-1111-2222',
      email: null,
      fax: null,
      address: null,
      notes: null,
      created_at: new Date('2026-03-28T00:00:00.000Z'),
      updated_at: new Date('2026-03-28T00:00:00.000Z'),
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        externalProfessional: {
          create: externalProfessionalCreateMock,
        },
      }),
    );
  });

  it('lists external professionals with query filters', async () => {
    const response = (await GET({
      orgId: 'org_1',
      userId: 'user_1',
      role: 'pharmacist',
      nextUrl: new URL('http://localhost/api/admin/external-professionals?q=訪看'),
    } as unknown as NextRequest & { orgId: string; userId: string; role: string; nextUrl: URL }))!;

    expect(response.status).toBe(200);
    expect(externalProfessionalFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        OR: [
          { name: { contains: '訪看', mode: 'insensitive' } },
          { organization_name: { contains: '訪看', mode: 'insensitive' } },
        ],
      },
      orderBy: [{ profession_type: 'asc' }, { name: 'asc' }],
    });
  });

  it('creates an external professional master row', async () => {
    const response = (await POST({
      orgId: 'org_1',
      userId: 'user_1',
      role: 'admin',
      json: async () => ({
        profession_type: 'care_manager',
        name: '山田 ケアマネ',
        organization_name: '居宅支援A',
        phone: '03-1111-2222',
      }),
    } as unknown as NextRequest & { orgId: string; userId: string; role: string }))!;

    expect(response.status).toBe(201);
    expect(externalProfessionalCreateMock).toHaveBeenCalledWith({
      data: {
        org_id: 'org_1',
        profession_type: 'care_manager',
        name: '山田 ケアマネ',
        organization_name: '居宅支援A',
        department: null,
        phone: '03-1111-2222',
        email: null,
        fax: null,
        address: null,
        notes: null,
      },
    });
  });
});
