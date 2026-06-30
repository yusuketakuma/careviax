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
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'admin' }, routeContext);
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

const createRequest = (query = '') =>
  new NextRequest(`http://localhost/api/admin/external-professionals/external_1/patients${query}`);

describe('/api/admin/external-professionals/[id]/patients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    externalProfessionalFindFirstMock.mockResolvedValue({ id: 'external_1' });
    careTeamLinkCountMock.mockResolvedValue(1);
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
            archived_at: null,
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
        case_: { patient: { archived_at: null } },
      },
      orderBy: [
        { is_primary: 'desc' },
        { case_: { patient: { name_kana: 'asc' } } },
        { created_at: 'asc' },
      ],
      take: 101,
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
                archived_at: true,
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
          archive: { status: 'active', archived: false, archived_at: null },
        },
      ],
      metadata: {
        limit: 100,
        total_count: 1,
        visible_count: 1,
        hidden_count: 0,
        has_more: false,
        count_basis: 'care_team_links',
        filters_applied: {
          external_professional_id: 'external_1',
          archive_status: 'active',
          assignment_scoped: false,
        },
      },
    });
  });

  it('returns archived linked patients only when archive_status=archived is explicit and exposes hidden counts', async () => {
    careTeamLinkCountMock.mockResolvedValue(2);
    careTeamLinkFindManyMock.mockResolvedValue([
      {
        id: 'link_archived_1',
        role: 'care_manager',
        is_primary: true,
        case_id: 'case_archived_1',
        case_: {
          status: 'archived',
          patient: {
            id: 'patient_archived_1',
            name: '佐藤 太郎',
            name_kana: 'サトウ タロウ',
            archived_at: new Date('2026-04-01T09:30:00.000Z'),
          },
        },
      },
      {
        id: 'link_archived_2',
        role: 'nurse',
        is_primary: false,
        case_id: 'case_archived_2',
        case_: {
          status: 'archived',
          patient: {
            id: 'patient_archived_2',
            name: '鈴木 花子',
            name_kana: 'スズキ ハナコ',
            archived_at: new Date('2026-04-02T09:30:00.000Z'),
          },
        },
      },
    ]);

    const response = (await GET(createRequest('?archive_status=archived&limit=1'), {
      params: Promise.resolve({ id: 'external_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(careTeamLinkCountMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        external_professional_id: 'external_1',
        case_: { patient: { archived_at: { not: null } } },
      },
    });
    expect(careTeamLinkFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          external_professional_id: 'external_1',
          case_: { patient: { archived_at: { not: null } } },
        },
        take: 2,
      }),
    );
    const body = await response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      id: 'link_archived_1',
      patient_id: 'patient_archived_1',
      archived_at: '2026-04-01T09:30:00.000Z',
      archive: {
        status: 'archived',
        archived: true,
        archived_at: '2026-04-01T09:30:00.000Z',
      },
    });
    expect(body.metadata).toMatchObject({
      limit: 1,
      total_count: 2,
      visible_count: 1,
      hidden_count: 1,
      has_more: true,
      filters_applied: { archive_status: 'archived' },
    });
  });

  it('rejects malformed limit values before loading the external professional', async () => {
    const response = (await GET(createRequest('?limit=1.5'), {
      params: Promise.resolve({ id: 'external_1' }),
    }))!;

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { limit: ['limit は整数で指定してください'] },
    });
    expect(externalProfessionalFindFirstMock).not.toHaveBeenCalled();
    expect(careTeamLinkCountMock).not.toHaveBeenCalled();
    expect(careTeamLinkFindManyMock).not.toHaveBeenCalled();
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
