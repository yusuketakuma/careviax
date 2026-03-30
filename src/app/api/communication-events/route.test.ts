import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  communicationEventFindManyMock,
  communicationEventCreateMock,
  learnContactProfileFromCommunicationMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  communicationEventFindManyMock: vi.fn(),
  communicationEventCreateMock: vi.fn(),
  learnContactProfileFromCommunicationMock: vi.fn(),
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

vi.mock('@/lib/contact-profiles', () => ({
  learnContactProfileFromCommunication: learnContactProfileFromCommunicationMock,
}));

import { GET, POST } from './route';

describe('/api/communication-events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    communicationEventFindManyMock.mockResolvedValue([{ id: 'event_1', event_type: 'fax' }]);
    communicationEventCreateMock.mockResolvedValue({
      id: 'event_2',
      counterpart_name: undefined,
      counterpart_contact: undefined,
      channel: 'fax',
      direction: 'outbound',
      occurred_at: new Date('2026-03-30T01:00:00.000Z'),
    });
    learnContactProfileFromCommunicationMock.mockResolvedValue(undefined);
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
    expect(learnContactProfileFromCommunicationMock).toHaveBeenCalledWith(
      expect.anything(),
      {
        orgId: 'org_1',
        counterpartName: undefined,
        counterpartContact: undefined,
        channel: 'fax',
        occurredAt: expect.anything(),
        markSuccess: true,
      }
    );
  });
});
