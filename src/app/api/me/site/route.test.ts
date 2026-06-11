import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  pharmacySiteFindFirstMock,
  membershipFindFirstMock,
  userFindUniqueMock,
  withOrgContextMock,
  userUpdateMock,
  auditLogCreateMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  pharmacySiteFindFirstMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  userUpdateMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) =>
    async (req: NextRequest) => {
      const authResult = await requireAuthContextMock();
      if ('response' in authResult) return authResult.response;
      return handler(req, authResult.ctx, { params: Promise.resolve({}) });
    },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    pharmacySite: { findFirst: pharmacySiteFindFirstMock },
    membership: { findFirst: membershipFindFirstMock },
    user: { findUnique: userFindUniqueMock },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { PUT } from './route';

const routeCtx = { params: Promise.resolve({}) };

function makePutRequest(body: unknown) {
  return new NextRequest('http://localhost/api/me/site', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/me/site PUT', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        userId: 'user_1',
        orgId: 'org_1',
        role: 'pharmacist',
        ipAddress: '127.0.0.1',
        userAgent: 'test',
      },
    });
    pharmacySiteFindFirstMock.mockResolvedValue({ id: 'site_2', name: '東部店' });
    membershipFindFirstMock.mockResolvedValue({ id: 'mem_1' });
    userFindUniqueMock.mockResolvedValue({ default_site_id: 'site_1' });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId: string, callback: (tx: unknown) => unknown) =>
      callback({ user: { update: userUpdateMock }, auditLog: { create: auditLogCreateMock } }),
    );
    userUpdateMock.mockResolvedValue({ id: 'user_1' });
  });

  it('updates default_site_id and creates an audit log', async () => {
    const response = await PUT(makePutRequest({ site_id: 'site_2' }), routeCtx);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({ site_id: 'site_2' });

    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function));
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'user_site_switched',
        target_type: 'PharmacySite',
        target_id: 'site_2',
        changes: { from_site_id: 'site_1', to_site_id: 'site_2' },
      }),
    });
  });

  it('returns 400 when site_id is missing', async () => {
    const response = await PUT(makePutRequest({}), routeCtx);

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns 404 when site does not belong to org', async () => {
    pharmacySiteFindFirstMock.mockResolvedValue(null);

    const response = await PUT(makePutRequest({ site_id: 'other_site' }), routeCtx);

    expect(response.status).toBe(404);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns 403 when user has no membership for the target site', async () => {
    membershipFindFirstMock.mockResolvedValue(null);

    const response = await PUT(makePutRequest({ site_id: 'site_2' }), routeCtx);

    expect(response.status).toBe(403);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns 400 when request body is malformed JSON', async () => {
    const req = new NextRequest('http://localhost/api/me/site', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{"site_id":',
    });

    const response = await PUT(req, routeCtx);

    expect(response.status).toBe(400);
  });
});
