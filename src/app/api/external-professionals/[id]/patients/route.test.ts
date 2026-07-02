import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { externalProfessionalFindFirstMock, careTeamLinkCountMock, careTeamLinkFindManyMock } =
  vi.hoisted(() => ({
    externalProfessionalFindFirstMock: vi.fn(),
    careTeamLinkCountMock: vi.fn(),
    careTeamLinkFindManyMock: vi.fn(),
  }));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(
        req,
        { orgId: 'org_1', userId: 'user_1', ipAddress: '127.0.0.1', userAgent: 'vitest' },
        routeContext,
      );
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    externalProfessional: {
      findFirst: externalProfessionalFindFirstMock,
    },
    careTeamLink: {
      count: careTeamLinkCountMock,
      findMany: careTeamLinkFindManyMock,
    },
  },
}));

import { GET } from './route';

const createRequest = () =>
  new NextRequest('http://localhost/api/external-professionals/ep_1/patients');

describe('/api/external-professionals/[id]/patients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    externalProfessionalFindFirstMock.mockResolvedValue({ id: 'ep_1' });
    careTeamLinkCountMock.mockResolvedValue(1);
    careTeamLinkFindManyMock.mockResolvedValue([
      {
        id: 'link_1',
        role: 'attending_doctor',
        is_primary: true,
        case_id: 'case_1',
        case_: {
          id: 'case_1',
          status: 'active',
          patient: {
            id: 'patient_1',
            name: '山田太郎',
            name_kana: 'ヤマダタロウ',
            archived_at: null,
          },
        },
      },
    ]);
  });

  it('returns 200 with linked patients', async () => {
    const response = (await GET(createRequest(), { params: Promise.resolve({ id: 'ep_1' }) }))!;

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].patient_name).toBe('山田太郎');
  });

  it('returns 404 when professional not found', async () => {
    externalProfessionalFindFirstMock.mockResolvedValue(null);

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'nonexistent' }),
    }))!;

    expect(response.status).toBe(404);
  });
});
