import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const { requirePlatformOperatorMock, revokeBreakGlassSessionMock, serializeSessionMock } =
  vi.hoisted(() => ({
    requirePlatformOperatorMock: vi.fn(),
    revokeBreakGlassSessionMock: vi.fn(),
    serializeSessionMock: vi.fn(),
  }));

vi.mock('@/lib/platform/operator', () => ({
  requirePlatformOperator: requirePlatformOperatorMock,
}));

vi.mock('@/lib/platform/break-glass', () => ({
  revokeBreakGlassSession: revokeBreakGlassSessionMock,
  serializeBreakGlassSession: serializeSessionMock,
}));

import { DELETE } from './route';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const operator = { id: 'operator_1', userId: 'user_1', role: 'platform_operator' };

function createRequest() {
  return new NextRequest('http://localhost/api/platform/break-glass/bg_1', {
    method: 'DELETE',
  });
}

describe('DELETE /api/platform/break-glass/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePlatformOperatorMock.mockResolvedValue({ operator });
    revokeBreakGlassSessionMock.mockResolvedValue({ id: 'bg_1', status: 'revoked' });
    serializeSessionMock.mockReturnValue({
      id: 'bg_1',
      target_org_id: 'org_1',
      status: 'revoked',
      revoked_at: '2026-07-10T06:00:00.000Z',
    });
  });

  it('does not revoke when the platform operator guard rejects the request', async () => {
    requirePlatformOperatorMock.mockResolvedValueOnce({
      response: NextResponse.json({ code: 'AUTH_FORBIDDEN' }, { status: 403 }),
    });

    const response = await DELETE(createRequest(), {
      params: Promise.resolve({ id: 'bg_1' }),
    });

    expect(response.status).toBe(403);
    expect(revokeBreakGlassSessionMock).not.toHaveBeenCalled();
    expect(serializeSessionMock).not.toHaveBeenCalled();
  });

  it('returns a no-store 404 when the session is not revocable', async () => {
    revokeBreakGlassSessionMock.mockResolvedValueOnce(null);

    const response = await DELETE(createRequest(), {
      params: Promise.resolve({ id: 'missing' }),
    });

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(revokeBreakGlassSessionMock).toHaveBeenCalledWith(operator, 'missing');
    expect(serializeSessionMock).not.toHaveBeenCalled();
  });

  it('returns the revoked session in an exact data envelope', async () => {
    const revoked = { id: 'bg_1', status: 'revoked' };
    revokeBreakGlassSessionMock.mockResolvedValueOnce(revoked);

    const response = await DELETE(createRequest(), {
      params: Promise.resolve({ id: 'bg_1' }),
    });

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(revokeBreakGlassSessionMock).toHaveBeenCalledWith(operator, 'bg_1');
    expect(serializeSessionMock).toHaveBeenCalledWith(revoked);
    await expect(response.json()).resolves.toEqual({
      data: {
        session: {
          id: 'bg_1',
          target_org_id: 'org_1',
          status: 'revoked',
          revoked_at: '2026-07-10T06:00:00.000Z',
        },
      },
    });
  });
});
