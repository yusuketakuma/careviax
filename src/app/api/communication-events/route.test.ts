import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  communicationEventFindManyMock,
  communicationEventCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  communicationEventFindManyMock: vi.fn(),
  communicationEventCreateMock: vi.fn(),
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
    communicationEvent: {
      findMany: communicationEventFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

describe('/api/communication-events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    communicationEventFindManyMock.mockResolvedValue([{ id: 'event_1', event_type: 'fax' }]);
    communicationEventCreateMock.mockResolvedValue({ id: 'event_2' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        communicationEvent: {
          create: communicationEventCreateMock,
        },
      }),
    );
  });

  it('lists communication events', async () => {
    const response = (await GET({
      url: 'http://localhost/api/communication-events?patient_id=patient_1',
    } as NextRequest))!;

    expect(response.status).toBe(200);
  });

  it('creates a communication event', async () => {
    const response = (await POST({
      json: async () => ({
        event_type: 'fax',
        channel: 'fax',
        direction: 'outbound',
      }),
    } as NextRequest))!;

    expect(response.status).toBe(201);
    expect(communicationEventCreateMock).toHaveBeenCalled();
  });
});
