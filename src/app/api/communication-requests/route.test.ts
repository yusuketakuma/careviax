import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  communicationRequestFindManyMock,
  communicationRequestCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  communicationRequestFindManyMock: vi.fn(),
  communicationRequestCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (
    handler: (req: NextRequest & { orgId: string; userId: string }) => Promise<Response>,
  ) => {
    return (req: NextRequest) =>
      handler({
        ...req,
        orgId: 'org_1',
        userId: 'user_1',
      } as NextRequest & { orgId: string; userId: string });
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    communicationRequest: {
      findMany: communicationRequestFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

describe('/api/communication-requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    communicationRequestFindManyMock.mockResolvedValue([{ id: 'request_1', status: 'draft' }]);
    communicationRequestCreateMock.mockResolvedValue({ id: 'request_2', status: 'draft' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        communicationRequest: {
          create: communicationRequestCreateMock,
        },
      }),
    );
  });

  it('lists communication requests', async () => {
    const response = (await GET({
      url: 'http://localhost/api/communication-requests?status=draft',
    } as NextRequest))!;

    expect(response.status).toBe(200);
  });

  it('creates a communication request', async () => {
    const response = (await POST({
      json: async () => ({
        request_type: '疑義照会',
        subject: '確認事項',
        content: '処方内容を確認したいです',
      }),
    } as NextRequest))!;

    expect(response.status).toBe(201);
    expect(communicationRequestCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        request_type: '疑義照会',
        requested_by: 'user_1',
      }),
    });
  });
});
