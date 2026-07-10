import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const {
  requirePlatformOperatorMock,
  listActiveBreakGlassSessionsMock,
  serializeSessionMock,
  createBreakGlassSessionMock,
  verifyBreakGlassStepUpMock,
  loggerWarnMock,
} = vi.hoisted(() => ({
  requirePlatformOperatorMock: vi.fn(),
  listActiveBreakGlassSessionsMock: vi.fn(),
  serializeSessionMock: vi.fn(),
  createBreakGlassSessionMock: vi.fn(),
  verifyBreakGlassStepUpMock: vi.fn(),
  loggerWarnMock: vi.fn(),
}));

vi.mock('@/lib/platform/operator', () => ({
  requirePlatformOperator: requirePlatformOperatorMock,
}));

vi.mock('@/lib/platform/break-glass', () => {
  class BreakGlassAccessError extends Error {
    code: string;

    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }

  return {
    BreakGlassAccessError,
    createBreakGlassSession: createBreakGlassSessionMock,
    listActiveBreakGlassSessions: listActiveBreakGlassSessionsMock,
    serializeBreakGlassSession: serializeSessionMock,
  };
});

vi.mock('@/lib/platform/step-up-mfa', () => ({
  verifyBreakGlassStepUp: verifyBreakGlassStepUpMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { warn: loggerWarnMock },
}));

import { GET, POST } from './route';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const operator = {
  operatorId: 'operator_1',
  userId: 'user_1',
  email: 'operator@example.invalid',
  role: 'platform_operator',
};

function createRequest() {
  return new NextRequest('http://localhost/api/platform/break-glass');
}

describe('GET /api/platform/break-glass', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePlatformOperatorMock.mockResolvedValue({ operator });
    listActiveBreakGlassSessionsMock.mockResolvedValue([
      { id: 'bg_1', target_org_id: 'org_1', status: 'active' },
    ]);
    serializeSessionMock.mockReturnValue({
      id: 'bg_1',
      target_org_id: 'org_1',
      status: 'active',
    });
  });

  it('does not list sessions when the platform operator guard rejects the request', async () => {
    requirePlatformOperatorMock.mockResolvedValueOnce({
      response: NextResponse.json({ code: 'AUTH_FORBIDDEN' }, { status: 403 }),
    });

    const response = await GET(createRequest());

    expect(response.status).toBe(403);
    expect(listActiveBreakGlassSessionsMock).not.toHaveBeenCalled();
    expect(serializeSessionMock).not.toHaveBeenCalled();
  });

  it('returns operator-owned active sessions in an exact data envelope', async () => {
    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(listActiveBreakGlassSessionsMock).toHaveBeenCalledWith('operator_1');
    expect(serializeSessionMock).toHaveBeenCalledWith({
      id: 'bg_1',
      target_org_id: 'org_1',
      status: 'active',
    });
    await expect(response.json()).resolves.toEqual({
      data: {
        sessions: [
          {
            id: 'bg_1',
            target_org_id: 'org_1',
            status: 'active',
          },
        ],
      },
    });
  });
});

describe('POST /api/platform/break-glass', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePlatformOperatorMock.mockResolvedValue({ operator });
    verifyBreakGlassStepUpMock.mockResolvedValue(true);
    createBreakGlassSessionMock.mockResolvedValue({
      id: 'bg_2',
      target_org_id: 'org_2',
      status: 'active',
    });
    serializeSessionMock.mockReturnValue({
      id: 'bg_2',
      target_org_id: 'org_2',
      scope: 'read_only',
      status: 'active',
    });
  });

  function createPostRequest() {
    return new NextRequest('http://localhost/api/platform/break-glass', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        targetOrgId: ' org_2 ',
        reason: ' 障害調査のためアクセスします ',
        referenceTicket: ' SUP-123 ',
        scope: 'read_only',
        password: 'test-password',
        mfaCode: ' 123456 ',
      }),
    });
  }

  it('does not verify credentials or create a session when the guard rejects the request', async () => {
    requirePlatformOperatorMock.mockResolvedValueOnce({
      response: NextResponse.json({ code: 'AUTH_FORBIDDEN' }, { status: 403 }),
    });

    const response = await POST(createPostRequest());

    expect(response.status).toBe(403);
    expect(verifyBreakGlassStepUpMock).not.toHaveBeenCalled();
    expect(createBreakGlassSessionMock).not.toHaveBeenCalled();
  });

  it('fails closed without creating a session when step-up authentication fails', async () => {
    verifyBreakGlassStepUpMock.mockResolvedValueOnce(false);

    const response = await POST(createPostRequest());

    expect(response.status).toBe(401);
    expectSensitiveNoStore(response);
    expect(verifyBreakGlassStepUpMock).toHaveBeenCalledWith({
      email: 'operator@example.invalid',
      password: 'test-password',
      code: '123456',
    });
    expect(createBreakGlassSessionMock).not.toHaveBeenCalled();
    expect(loggerWarnMock).toHaveBeenCalledWith({
      event: 'break_glass_stepup_failed',
      actorId: 'user_1',
    });
  });

  it('returns the created session in an exact data envelope after step-up', async () => {
    const session = { id: 'bg_2', target_org_id: 'org_2', status: 'active' };
    createBreakGlassSessionMock.mockResolvedValueOnce(session);

    const response = await POST(createPostRequest());

    expect(response.status).toBe(201);
    expectSensitiveNoStore(response);
    expect(verifyBreakGlassStepUpMock).toHaveBeenCalledWith({
      email: 'operator@example.invalid',
      password: 'test-password',
      code: '123456',
    });
    expect(createBreakGlassSessionMock).toHaveBeenCalledWith({
      operator,
      targetOrgId: 'org_2',
      reason: '障害調査のためアクセスします',
      referenceTicket: 'SUP-123',
      scope: 'read_only',
      mfaVerifiedAt: expect.any(Date),
    });
    expect(serializeSessionMock).toHaveBeenCalledWith(session);
    await expect(response.json()).resolves.toEqual({
      data: {
        session: {
          id: 'bg_2',
          target_org_id: 'org_2',
          scope: 'read_only',
          status: 'active',
        },
      },
    });
  });
});
