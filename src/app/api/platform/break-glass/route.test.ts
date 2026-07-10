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

import { GET } from './route';
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
