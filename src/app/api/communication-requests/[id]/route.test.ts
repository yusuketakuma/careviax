import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  communicationRequestFindFirstMock,
  communicationRequestUpdateMock,
  communicationResponseCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  communicationRequestFindFirstMock: vi.fn(),
  communicationRequestUpdateMock: vi.fn(),
  communicationResponseCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    communicationRequest: {
      findFirst: communicationRequestFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { PATCH } from './route';

function createRequest(body: unknown, headers?: Record<string, string>) {
  return {
    headers: {
      get: (key: string) => headers?.[key] ?? null,
    },
    json: async () => body,
  } as unknown as NextRequest;
}

describe('/api/communication-requests/[id] PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      status: 'received',
    });
    communicationRequestUpdateMock.mockResolvedValue({
      id: 'request_1',
      status: 'responded',
      responses: [],
    });
    communicationResponseCreateMock.mockResolvedValue({ id: 'response_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        communicationRequest: {
          update: communicationRequestUpdateMock,
        },
        communicationResponse: {
          create: communicationResponseCreateMock,
        },
      })
    );
  });

  it('rejects invalid status transitions', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      status: 'draft',
    });

    const response = await PATCH(
      createRequest({ status: 'received' }, { 'x-org-id': 'org_1' }),
      { params: Promise.resolve({ id: 'request_1' }) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'draft から received へは遷移できません',
    });
    expect(communicationRequestUpdateMock).not.toHaveBeenCalled();
  });

  it('records a response and auto-advances to responded', async () => {
    const response = await PATCH(
      createRequest(
        {
          response: {
            responder_name: '在宅主治医',
            content: '現行処方で継続',
          },
        },
        { 'x-org-id': 'org_1' }
      ),
      { params: Promise.resolve({ id: 'request_1' }) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(communicationResponseCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        request_id: 'request_1',
        responder_name: '在宅主治医',
        content: '現行処方で継続',
      }),
    });
    expect(communicationRequestUpdateMock).toHaveBeenCalledWith({
      where: { id: 'request_1' },
      data: { status: 'responded' },
      select: expect.any(Object),
    });
  });
});
