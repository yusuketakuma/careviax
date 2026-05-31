import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type AuthenticatedTestRequest = NextRequest & {
  orgId: string;
  userId: string;
};

const { withOrgContextMock } = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: (req: AuthenticatedTestRequest) => Promise<Response>) => {
    return (req: NextRequest) =>
      handler(
        Object.assign(req, {
          orgId: 'org_1',
          userId: 'user_1',
        }) as AuthenticatedTestRequest,
      );
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET } from './route';

function createGetRequest(search = '') {
  return new NextRequest(
    `http://localhost/api/conference-notes/participant-suggestions${search}`,
  );
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
