import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { authMock, membershipFindFirstMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
}));

vi.mock('../config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
  },
}));

import { getAuthContext, requireAuthContext } from '../context';

function createRequest(orgId?: string) {
  return {
    headers: {
      get: (key: string) => (key === 'x-org-id' ? orgId ?? null : null),
    },
  } as unknown as NextRequest;
}

describe('getAuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when the session is missing', async () => {
    authMock.mockResolvedValue(null);

    const result = await getAuthContext(createRequest('org_1'));

    expect(result).toBeNull();
    expect(membershipFindFirstMock).not.toHaveBeenCalled();
  });

  it('returns null when org header is missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });

    const result = await getAuthContext(createRequest());

    expect(result).toBeNull();
    expect(membershipFindFirstMock).not.toHaveBeenCalled();
  });

  it('returns null when the user has no active membership for the org', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue(null);

    const result = await getAuthContext(createRequest('org_1'));

    expect(result).toBeNull();
    expect(membershipFindFirstMock).toHaveBeenCalledWith({
      where: { user_id: 'user_1', org_id: 'org_1', is_active: true },
      select: { role: true },
    });
  });

  it('returns user, org, and role when membership exists', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const result = await getAuthContext(createRequest('org_1'));

    expect(result).toEqual({
      userId: 'user_1',
      orgId: 'org_1',
      role: 'admin',
    });
  });
});

describe('requireAuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when the session is missing', async () => {
    authMock.mockResolvedValue(null);

    const result = await requireAuthContext(createRequest('org_1'));

    expect('response' in result).toBe(true);
    const response = 'response' in result ? result.response : undefined;
    expect(response).toBeDefined();
    if (!response) throw new Error('response is required');
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_UNAUTHENTICATED',
    });
  });

  it('returns 400 when org header is missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });

    const result = await requireAuthContext(createRequest());

    expect('response' in result).toBe(true);
    const response = 'response' in result ? result.response : undefined;
    expect(response).toBeDefined();
    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_NO_ORG',
    });
  });

  it('returns 403 when membership is missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue(null);

    const result = await requireAuthContext(createRequest('org_1'));

    expect('response' in result).toBe(true);
    const response = 'response' in result ? result.response : undefined;
    expect(response).toBeDefined();
    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
  });

  it('returns 403 when role lacks the requested permission', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'clerk' });

    const result = await requireAuthContext(createRequest('org_1'), {
      permission: 'canVisit',
      message: '閲覧権限がありません',
    });

    expect('response' in result).toBe(true);
    const response = 'response' in result ? result.response : undefined;
    expect(response).toBeDefined();
    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
      message: '閲覧権限がありません',
    });
  });

  it('returns auth context when permission check passes', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const result = await requireAuthContext(createRequest('org_1'), {
      permission: 'canVisit',
    });

    expect(result).toEqual({
      ctx: {
        userId: 'user_1',
        orgId: 'org_1',
        role: 'admin',
      },
    });
  });
});
