import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  externalProfessionalFindFirstMock,
  communicationRequestFindManyMock,
  communicationEventFindManyMock,
} = vi.hoisted(() => ({
  externalProfessionalFindFirstMock: vi.fn(),
  communicationRequestFindManyMock: vi.fn(),
  communicationEventFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'admin' }, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    externalProfessional: {
      findFirst: externalProfessionalFindFirstMock,
    },
    communicationRequest: {
      findMany: communicationRequestFindManyMock,
    },
    communicationEvent: {
      findMany: communicationEventFindManyMock,
    },
  },
}));

import { GET } from './route';

describe('/api/admin/external-professionals/[id]/communications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    externalProfessionalFindFirstMock.mockResolvedValue({
      id: 'external_1',
      name: '佐藤医師',
      organization_name: 'あおばクリニック',
    });
    communicationRequestFindManyMock.mockResolvedValue([
      {
        id: 'request_1',
        request_type: 'care_report_followup',
        recipient_name: '佐藤医師',
        recipient_role: 'physician',
        subject: '報告書確認',
        status: 'sent',
        requested_at: new Date('2026-03-30T00:00:00.000Z'),
      },
    ]);
    communicationEventFindManyMock.mockResolvedValue([
      {
        id: 'event_1',
        event_type: 'phone_call',
        channel: 'phone',
        direction: 'outbound',
        counterpart_name: '佐藤医師',
        subject: '電話確認',
        occurred_at: new Date('2026-03-29T00:00:00.000Z'),
      },
    ]);
  });

  it('returns communication history matched by counterpart/recipient names', async () => {
    const response = (await GET({} as NextRequest, {
      params: Promise.resolve({ id: 'external_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(communicationRequestFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        OR: [{ recipient_name: '佐藤医師' }, { recipient_name: 'あおばクリニック' }],
      },
      orderBy: { requested_at: 'desc' },
      take: 20,
      select: {
        id: true,
        request_type: true,
        recipient_name: true,
        recipient_role: true,
        subject: true,
        status: true,
        requested_at: true,
      },
    });
    expect(communicationEventFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        OR: [{ counterpart_name: '佐藤医師' }, { counterpart_name: 'あおばクリニック' }],
      },
      orderBy: { occurred_at: 'desc' },
      take: 20,
      select: {
        id: true,
        event_type: true,
        channel: true,
        direction: true,
        counterpart_name: true,
        subject: true,
        occurred_at: true,
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        requests: [{ id: 'request_1' }],
        events: [{ id: 'event_1' }],
      },
    });
  });
});
