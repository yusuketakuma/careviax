import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';

const {
  externalProfessionalFindFirstMock,
  communicationRequestCountMock,
  communicationRequestFindManyMock,
  communicationEventCountMock,
  communicationEventFindManyMock,
} = vi.hoisted(() => ({
  externalProfessionalFindFirstMock: vi.fn(),
  communicationRequestCountMock: vi.fn(),
  communicationRequestFindManyMock: vi.fn(),
  communicationEventCountMock: vi.fn(),
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
      count: communicationRequestCountMock,
      findMany: communicationRequestFindManyMock,
    },
    communicationEvent: {
      count: communicationEventCountMock,
      findMany: communicationEventFindManyMock,
    },
  },
}));

import { GET } from './route';

const createRequest = () =>
  new NextRequest('http://localhost/api/admin/external-professionals/external_1/communications');

describe('/api/admin/external-professionals/[id]/communications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    externalProfessionalFindFirstMock.mockResolvedValue({
      id: 'external_1',
      name: '佐藤医師',
      organization_name: 'あおばクリニック',
    });
    communicationRequestCountMock.mockResolvedValue(1);
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
    communicationEventCountMock.mockResolvedValue(1);
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
    expect(communicationRequestCountMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        OR: [{ recipient_name: '佐藤医師' }, { recipient_name: 'あおばクリニック' }],
      },
    });
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
    expect(communicationEventCountMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        OR: [{ counterpart_name: '佐藤医師' }, { counterpart_name: 'あおばクリニック' }],
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
      meta: {
        requests: {
          limit: 20,
          total_count: 1,
          visible_count: 1,
          hidden_count: 0,
          count_basis: 'external_professional_communication_requests',
          filters_applied: { external_professional_id: 'external_1' },
        },
        events: {
          limit: 20,
          total_count: 1,
          visible_count: 1,
          hidden_count: 0,
          count_basis: 'external_professional_communication_events',
          filters_applied: { external_professional_id: 'external_1' },
        },
      },
    });
  });

  it('returns count metadata when fixed communication history lists are truncated', async () => {
    communicationRequestCountMock.mockResolvedValueOnce(25);
    communicationEventCountMock.mockResolvedValueOnce(22);
    communicationRequestFindManyMock.mockResolvedValueOnce(
      Array.from({ length: 20 }, (_, index) => ({
        id: `request_${index + 1}`,
        patient_id: 'patient_1',
        request_type: 'care_report_followup',
        recipient_name: '佐藤医師',
        recipient_role: 'physician',
        related_entity_type: 'care_report',
        related_entity_id: `report_${index + 1}`,
        subject: '報告書確認',
        status: 'sent',
        requested_at: new Date('2026-03-30T00:00:00.000Z'),
      })),
    );
    communicationEventFindManyMock.mockResolvedValueOnce(
      Array.from({ length: 20 }, (_, index) => ({
        id: `event_${index + 1}`,
        event_type: 'phone_call',
        channel: 'phone',
        direction: 'outbound',
        counterpart_name: '佐藤医師',
        subject: '電話確認',
        occurred_at: new Date('2026-03-29T00:00:00.000Z'),
      })),
    );

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'external_1' }),
    }))!;

    expect(response.status).toBe(200);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        requests: expect.arrayContaining([expect.objectContaining({ id: 'request_1' })]),
        events: expect.arrayContaining([expect.objectContaining({ id: 'event_1' })]),
      },
      meta: {
        requests: {
          limit: 20,
          total_count: 25,
          visible_count: 20,
          hidden_count: 5,
          count_basis: 'external_professional_communication_requests',
        },
        events: {
          limit: 20,
          total_count: 22,
          visible_count: 20,
          hidden_count: 2,
          count_basis: 'external_professional_communication_events',
        },
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
    expect(communicationRequestCountMock).not.toHaveBeenCalled();
    expect(communicationRequestFindManyMock).not.toHaveBeenCalled();
    expect(communicationEventCountMock).not.toHaveBeenCalled();
    expect(communicationEventFindManyMock).not.toHaveBeenCalled();
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
