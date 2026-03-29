import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  facilityFindFirstMock,
  residenceFindFirstMock,
  facilityUpdateMock,
  facilityDeleteMock,
  facilityContactDeleteManyMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  facilityFindFirstMock: vi.fn(),
  residenceFindFirstMock: vi.fn(),
  facilityUpdateMock: vi.fn(),
  facilityDeleteMock: vi.fn(),
  facilityContactDeleteManyMock: vi.fn(),
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
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { DELETE, PATCH } from './route';

function createRequest(body?: unknown) {
  return {
    json: async () => body,
  } as unknown as NextRequest;
}

describe('/api/admin/facilities/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    facilityFindFirstMock.mockResolvedValue({ id: 'facility_1' });
    facilityUpdateMock.mockResolvedValue({
      id: 'facility_1',
      name: 'あおば苑',
      facility_type: 'group_home',
      address: '東京都千代田区1-1-1',
      phone: '03-1111-2222',
      fax: null,
      notes: '更新メモ',
      contacts: [
        {
          id: 'contact_1',
          name: '相談員A',
          role: '相談員',
          phone: '03-3333-4444',
          email: null,
          fax: null,
          is_primary: true,
          notes: null,
          created_at: new Date('2026-03-28T00:00:00.000Z'),
        },
      ],
    });
    facilityDeleteMock.mockResolvedValue({ id: 'facility_1' });
    residenceFindFirstMock.mockResolvedValue(null);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        facilityContact: {
          deleteMany: facilityContactDeleteManyMock,
        },
        residence: {
          findFirst: residenceFindFirstMock,
        },
        facility: {
          update: facilityUpdateMock,
          delete: facilityDeleteMock,
        },
      }),
    );
  });

  it('updates a facility and replaces nested contacts', async () => {
    const response = await PATCH(
      createRequest({
        name: 'あおば苑',
        facility_type: 'group_home',
        address: '東京都千代田区1-1-1',
        notes: '更新メモ',
        contacts: [
          {
            name: '相談員A',
            role: '相談員',
            phone: '03-3333-4444',
            is_primary: true,
          },
        ],
      }),
      { params: Promise.resolve({ id: 'facility_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(facilityContactDeleteManyMock).toHaveBeenCalledWith({
      where: { org_id: 'org_1', facility_id: 'facility_1' },
    });
    expect(facilityUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'facility_1' },
        data: expect.objectContaining({
          name: 'あおば苑',
          facility_type: 'group_home',
          contacts: {
            create: [
              expect.objectContaining({
                org_id: 'org_1',
                name: '相談員A',
                role: '相談員',
              }),
            ],
          },
        }),
      }),
    );
  });

  it('deletes a facility', async () => {
    const response = await DELETE(createRequest(), {
      params: Promise.resolve({ id: 'facility_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(facilityDeleteMock).toHaveBeenCalledWith({
      where: { id: 'facility_1' },
    });
  });

  it('returns conflict when the facility is referenced by a residence', async () => {
    residenceFindFirstMock.mockResolvedValue({ id: 'residence_1' });

    const response = await DELETE(createRequest(), {
      params: Promise.resolve({ id: 'facility_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expect(facilityDeleteMock).not.toHaveBeenCalled();
  });
});
