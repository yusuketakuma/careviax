import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  communicationRequestFindFirstMock,
  communicationResponseFindManyMock,
  communicationResponseCreateMock,
  communicationRequestUpdateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  communicationRequestFindFirstMock: vi.fn(),
  communicationResponseFindManyMock: vi.fn(),
  communicationResponseCreateMock: vi.fn(),
  communicationRequestUpdateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: { orgId: string; userId: string; role: string },
      routeContext: { params: Promise<{ id: string }> },
    ) => Promise<Response>,
  ) => {
    return (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    communicationRequest: {
      findFirst: communicationRequestFindFirstMock,
    },
    communicationResponse: {
      findMany: communicationResponseFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

describe('/api/communication-requests/[id]/responses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      status: 'sent',
    });
    communicationResponseFindManyMock.mockResolvedValue([{ id: 'response_1' }]);
    communicationResponseCreateMock.mockResolvedValue({ id: 'response_2' });
    communicationRequestUpdateMock.mockResolvedValue({ id: 'request_1', status: 'responded' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        communicationResponse: {
          create: communicationResponseCreateMock,
        },
        communicationRequest: {
          update: communicationRequestUpdateMock,
        },
      }),
    );
  });

  it('lists responses for a communication request', async () => {
    const response = await GET({} as NextRequest, {
      params: Promise.resolve({ id: 'request_1' }),
    });

    expect(response.status).toBe(200);
  });

  it('creates a response and updates the request status', async () => {
    const response = await POST({
      json: async () => ({
        responder_name: '医師A',
        content: '確認しました',
        responded_at: '2026-03-29',
      }),
    } as NextRequest, {
      params: Promise.resolve({ id: 'request_1' }),
    });

    expect(response.status).toBe(201);
    expect(communicationRequestUpdateMock).toHaveBeenCalledWith({
      where: { id: 'request_1' },
      data: { status: 'responded' },
    });
  });
});
