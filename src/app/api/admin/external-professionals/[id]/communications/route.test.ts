import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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

const createRequest = () =>
  new NextRequest('http://localhost/api/admin/external-professionals/external_1/communications');

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

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
        patient_id: 'patient_1',
        request_type: 'care_report_followup',
        recipient_name: '佐藤医師',
        recipient_role: 'physician',
        related_entity_type: 'care_report',
        related_entity_id: 'report_1',
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
    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'external_1' }),
    }))!;

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(communicationRequestFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        OR: [{ recipient_name: '佐藤医師' }, { recipient_name: 'あおばクリニック' }],
      },
      orderBy: { requested_at: 'desc' },
      take: 20,
      select: {
        id: true,
        patient_id: true,
        request_type: true,
        recipient_name: true,
        recipient_role: true,
        related_entity_type: true,
        related_entity_id: true,
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
        requests: [
          {
            id: 'request_1',
            patient_id: 'patient_1',
            related_entity_type: 'care_report',
            related_entity_id: 'report_1',
            action_href:
              '/communications/requests?status=sent&request_type=care_report_followup&patient_id=patient_1&request_id=request_1&related_entity_type=care_report&related_entity_id=report_1',
          },
        ],
        events: [{ id: 'event_1' }],
      },
    });
  });

  it('returns a no-store 404 when the professional is missing', async () => {
    externalProfessionalFindFirstMock.mockResolvedValueOnce(null);

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'missing' }),
    }))!;

    expect(response.status).toBe(404);
    expectNoStore(response);
  });

  it('returns a sanitized no-store 500 when communication history lookup fails unexpectedly', async () => {
    externalProfessionalFindFirstMock.mockRejectedValueOnce(
      new Error('raw external professional patient communication secret'),
    );

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'external_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
    });
    expect(JSON.stringify(body)).not.toContain('patient communication secret');
  });
});
