import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { withOrgContextMock } = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: { orgId: string; userId: string; role: 'pharmacist' },
      routeContext: { params: Promise<Record<string, string>> },
    ) => Promise<Response>,
  ) => {
    return (
      req: NextRequest,
      routeContext: { params: Promise<Record<string, string>> } = { params: Promise.resolve({}) },
    ) => {
      return handler(req, { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }, routeContext);
    };
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET as rawGET } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);

function createGetRequest(search = '') {
  return new NextRequest(`http://localhost/api/conference-notes/participant-suggestions${search}`);
}

describe('/api/conference-notes/participant-suggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        facility: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'facility_1',
            name: '施設A',
            contacts: [
              {
                id: 'contact_1',
                name: '相談員A',
                role: '相談員',
                phone: '03-1111-2222',
                email: 'contact@example.com',
                preferred_contact_method: 'phone',
              },
            ],
          }),
        },
      }),
    );
  });

  it('requires facility_id', async () => {
    const response = (await GET(createGetRequest()))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'facility_id は必須です',
    });
  });

  it('returns facility contact suggestions', async () => {
    const response = (await GET(createGetRequest('?facility_id=facility_1')))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          name: '相談員A',
          role: '相談員',
          source: 'facility_contact',
          facility_id: 'facility_1',
          facility_name: '施設A',
        },
      ],
    });
  });
});
