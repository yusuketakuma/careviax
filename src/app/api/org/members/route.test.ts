import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, membershipFindFirstMock, membershipFindManyMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
      findMany: membershipFindManyMock,
    },
  },
}));

import { GET as rawGET } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };

function createRequest(query = '?eligible=staff') {
  return new NextRequest(`http://localhost/api/org/members${query}`, {
    headers: { 'x-org-id': 'org_1' },
  });
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/org/members GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'admin_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    membershipFindManyMock.mockResolvedValue([
      {
        role: 'pharmacist',
        user: { id: 'pharmacist_1', name: '薬剤師 花子', name_kana: 'ヤクザイシ ハナコ' },
      },
      {
        role: 'clerk',
        user: { id: 'clerk_1', name: '事務 太郎', name_kana: 'ジム タロウ' },
      },
      {
        role: 'clerk',
        user: { id: 'clerk_1', name: '事務 太郎', name_kana: 'ジム タロウ' },
      },
    ]);
  });

  it('lists active staff-assignable org members with clerk roles included and deduped', async () => {
    const response = await rawGET(createRequest(), emptyRouteContext);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(membershipFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        is_active: true,
        role: { in: ['owner', 'admin', 'pharmacist', 'pharmacist_trainee', 'clerk'] },
        user: { is_active: true },
      },
      select: {
        role: true,
        user: {
          select: {
            id: true,
            name: true,
            name_kana: true,
          },
        },
      },
      orderBy: [{ user: { name_kana: 'asc' } }, { user_id: 'asc' }],
    });
    await expect(response.json()).resolves.toEqual({
      data: [
        { id: 'pharmacist_1', name: '薬剤師 花子', role: 'pharmacist' },
        { id: 'clerk_1', name: '事務 太郎', role: 'clerk' },
      ],
    });
  });

  it.each(['', '?eligible=', '?eligible=pharmacist'])(
    'rejects unsupported eligible filters for query "%s"',
    async (query) => {
      const response = await rawGET(createRequest(query), emptyRouteContext);

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(400);
      expectSensitiveNoStore(response);
      expect(membershipFindManyMock).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: { eligible: ['eligible=staff を指定してください'] },
      });
    },
  );

  it('returns sanitized no-store 500 responses when the member lookup fails', async () => {
    membershipFindManyMock.mockRejectedValueOnce(new Error('raw org member lookup failure'));

    const response = await rawGET(createRequest(), emptyRouteContext);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('raw org member lookup failure');
  });
});
