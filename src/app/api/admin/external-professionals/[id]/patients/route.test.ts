import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { externalProfessionalFindFirstMock, careTeamLinkFindManyMock } = vi.hoisted(() => ({
  externalProfessionalFindFirstMock: vi.fn(),
  careTeamLinkFindManyMock: vi.fn(),
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
    careTeamLink: {
      findMany: careTeamLinkFindManyMock,
    },
  },
}));

import { GET } from './route';

const createRequest = () =>
  new NextRequest('http://localhost/api/admin/external-professionals/external_1/patients');

describe('/api/admin/external-professionals/[id]/patients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    externalProfessionalFindFirstMock.mockResolvedValue({ id: 'external_1' });
    careTeamLinkFindManyMock.mockResolvedValue([
      {
        id: 'link_1',
        role: 'care_manager',
        is_primary: true,
        case_id: 'case_1',
        case_: {
          status: 'active',
          patient: {
            id: 'patient_1',
            name: '山田 花子',
            name_kana: 'ヤマダ ハナコ',
          },
        },
      },
    ]);
  });

  it('lists linked patients via care team reverse reference', async () => {
    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'external_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(careTeamLinkFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        external_professional_id: 'external_1',
      },
      orderBy: [
        { is_primary: 'desc' },
        { case_: { patient: { name_kana: 'asc' } } },
        { created_at: 'asc' },
      ],
      select: {
        id: true,
        role: true,
        is_primary: true,
        case_id: true,
        case_: {
          select: {
            id: true,
            status: true,
            patient: {
              select: {
                id: true,
                name: true,
                name_kana: true,
              },
            },
          },
        },
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: 'link_1',
          patient_id: 'patient_1',
          patient_name: '山田 花子',
          case_status: 'active',
        },
      ],
    });
  });

  it('returns a sanitized 500 with no-store headers when a query throws', async () => {
    careTeamLinkFindManyMock.mockRejectedValueOnce(
      new Error('raw external-professionals patients read failure'),
    );

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'external_1' }),
    }))!;

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');

    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain('raw external-professionals patients read failure');
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});
