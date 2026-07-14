import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const {
  requirePlatformOperatorMock,
  listActiveBreakGlassSessionsMock,
  serializeSessionMock,
  createBreakGlassSessionMock,
  verifyBreakGlassStepUpMock,
  checkAuthRateLimitMock,
  loggerWarnMock,
} = vi.hoisted(() => ({
  requirePlatformOperatorMock: vi.fn(),
  listActiveBreakGlassSessionsMock: vi.fn(),
  serializeSessionMock: vi.fn(),
  createBreakGlassSessionMock: vi.fn(),
  verifyBreakGlassStepUpMock: vi.fn(),
  checkAuthRateLimitMock: vi.fn(),
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

vi.mock('@/lib/api/rate-limit', () => ({
  checkAuthRateLimit: checkAuthRateLimitMock,
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
    checkAuthRateLimitMock.mockResolvedValue({
      allowed: true,
      remaining: 4,
      resetAt: Date.now() + 60_000,
    });
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

  function createPostRequest(options?: { body?: Record<string, unknown>; forwardedFor?: string }) {
    return new NextRequest('http://localhost/api/platform/break-glass', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(options?.forwardedFor ? { 'x-forwarded-for': options.forwardedFor } : {}),
      },
      body: JSON.stringify({
        targetOrgId: ' org_2 ',
        reason: ' 障害調査のためアクセスします ',
        referenceTicket: ' SUP-123 ',
        scope: 'read_only',
        password: 'test-password',
        mfaCode: ' 123456 ',
        ...options?.body,
      }),
    });
  }

  it('does not verify credentials or create a session when the guard rejects the request', async () => {
    requirePlatformOperatorMock.mockResolvedValueOnce({
      response: NextResponse.json({ code: 'AUTH_FORBIDDEN' }, { status: 403 }),
    });

    const response = await POST(createPostRequest());

    expect(response.status).toBe(403);
    expect(checkAuthRateLimitMock).not.toHaveBeenCalled();
    expect(verifyBreakGlassStepUpMock).not.toHaveBeenCalled();
    expect(createBreakGlassSessionMock).not.toHaveBeenCalled();
  });

  it('does not consume the step-up budget when required fields are invalid', async () => {
    const response = await POST(createPostRequest({ body: { reason: 'short' } }));

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(checkAuthRateLimitMock).not.toHaveBeenCalled();
    expect(verifyBreakGlassStepUpMock).not.toHaveBeenCalled();
    expect(createBreakGlassSessionMock).not.toHaveBeenCalled();
  });

  it('blocks before Cognito step-up when the operator-scoped attempt budget is exhausted', async () => {
    const request = createPostRequest();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(10_000);
    checkAuthRateLimitMock.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: 40_000,
    });

    const response = await POST(request);
    nowSpy.mockRestore();

    expect(response.status).toBe(429);
    expectSensitiveNoStore(response);
    expect(response.headers.get('retry-after')).toBe('30');
    await expect(response.json()).resolves.toEqual({
      code: 'RATE_LIMIT_EXCEEDED',
      message: '再認証の試行回数が上限を超えました。しばらくしてから再度お試しください',
    });
    expect(checkAuthRateLimitMock).toHaveBeenCalledWith('operator_1', '/api/platform/break-glass');
    expect(verifyBreakGlassStepUpMock).not.toHaveBeenCalled();
    expect(createBreakGlassSessionMock).not.toHaveBeenCalled();
    expect(loggerWarnMock).toHaveBeenCalledWith({
      event: 'break_glass_stepup_rate_limited',
      actorId: 'user_1',
    });
  });

  it('uses the same operator-scoped budget when the source IP changes', async () => {
    await POST(createPostRequest({ forwardedFor: '198.51.100.10' }));
    await POST(createPostRequest({ forwardedFor: '203.0.113.20' }));

    expect(checkAuthRateLimitMock).toHaveBeenNthCalledWith(
      1,
      'operator_1',
      '/api/platform/break-glass',
    );
    expect(checkAuthRateLimitMock).toHaveBeenNthCalledWith(
      2,
      'operator_1',
      '/api/platform/break-glass',
    );
    expect(verifyBreakGlassStepUpMock).toHaveBeenCalledTimes(2);
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
    expect(checkAuthRateLimitMock.mock.invocationCallOrder[0]).toBeLessThan(
      verifyBreakGlassStepUpMock.mock.invocationCallOrder[0],
    );
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
    expect(checkAuthRateLimitMock).toHaveBeenCalledWith('operator_1', '/api/platform/break-glass');
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
