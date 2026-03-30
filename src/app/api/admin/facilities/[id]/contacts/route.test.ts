import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  facilityFindFirstMock,
  facilityContactFindManyMock,
  facilityContactDeleteManyMock,
  facilityContactCreateManyMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  facilityFindFirstMock: vi.fn(),
  facilityContactFindManyMock: vi.fn(),
  facilityContactDeleteManyMock: vi.fn(),
  facilityContactCreateManyMock: vi.fn(),
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
    facility: {
      findFirst: facilityFindFirstMock,
    },
    facilityContact: {
      findMany: facilityContactFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, PUT } from './route';

function createRequest(body?: unknown) {
  return {
    json: async () => body,
  } as unknown as NextRequest;
}

describe('/api/admin/facilities/[id]/contacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    facilityFindFirstMock.mockResolvedValue({ id: 'facility_1' });
    facilityContactFindManyMock.mockResolvedValue([
      {
        id: 'contact_1',
        name: '相談員A',
        role: '相談員',
        phone: '03-3333-4444',
        email: null,
        fax: null,
        is_primary: true,
        notes: null,
      },
    ]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        facilityContact: {
          deleteMany: facilityContactDeleteManyMock,
          createMany: facilityContactCreateManyMock,
          findMany: facilityContactFindManyMock,
        },
      }),
    );
  });

  it('lists facility contacts', async () => {
    const response = await GET({} as NextRequest, {
      params: Promise.resolve({ id: 'facility_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'contact_1', name: '相談員A' }],
    });
  });

  it('replaces facility contacts', async () => {
    const response = await PUT(createRequest({
      contacts: [
        {
          name: '相談員A',
          role: '相談員',
          phone: '03-3333-4444',
          is_primary: true,
        },
      ],
    }), {
      params: Promise.resolve({ id: 'facility_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(facilityContactDeleteManyMock).toHaveBeenCalledWith({
      where: { org_id: 'org_1', facility_id: 'facility_1' },
    });
    expect(facilityContactCreateManyMock).toHaveBeenCalledWith({
      data: [
        {
          org_id: 'org_1',
          facility_id: 'facility_1',
          name: '相談員A',
          role: '相談員',
          phone: '03-3333-4444',
          email: null,
          fax: null,
          is_primary: true,
          notes: null,
        },
      ],
    });
  });
});
