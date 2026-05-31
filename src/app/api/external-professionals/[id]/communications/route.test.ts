import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  externalProfessionalFindFirstMock,
  careTeamLinkFindManyMock,
  communicationRequestFindManyMock,
  communicationEventFindManyMock,
} = vi.hoisted(() => ({
  externalProfessionalFindFirstMock: vi.fn(),
  careTeamLinkFindManyMock: vi.fn(),
  communicationRequestFindManyMock: vi.fn(),
  communicationEventFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(
        req,
        { orgId: 'org_1', userId: 'user_1', ipAddress: '127.0.0.1', userAgent: 'vitest' },
        routeContext,
      );
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    externalProfessional: {
      findFirst: externalProfessionalFindFirstMock,
    },
    careTeamLink: {
      findMany: careTeamLinkFindManyMock,
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
  new NextRequest('http://localhost/api/external-professionals/ep_1/communications');

describe('/api/external-professionals/[id]/communications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    externalProfessionalFindFirstMock.mockResolvedValue({
      id: 'ep_1',
      name: '田中医師',
      organization_name: 'テスト病院',
    });
    careTeamLinkFindManyMock.mockResolvedValue([
      {
        case_id: 'case_1',
        case_: { patient_id: 'patient_1' },
      },
    ]);
    communicationRequestFindManyMock.mockResolvedValue([
      {
        id: 'req_1',
        request_type: 'tracing_report',
        recipient_name: '田中医師',
        recipient_role: 'doctor',
        subject: 'トレーシングレポート',
        status: 'completed',
        requested_at: new Date('2026-03-01'),
      },
    ]);
    communicationEventFindManyMock.mockResolvedValue([]);
  });

  it('returns 200 with communication history', async () => {
    const response = (await GET(createRequest(), { params: Promise.resolve({ id: 'ep_1' }) }))!;

    expect(response.status).toBe(200);
    expect(careTeamLinkFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        external_professional_id: 'ep_1',
        case_: {
          OR: [
            { primary_pharmacist_id: 'user_1' },
            { backup_pharmacist_id: 'user_1' },
            { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
          ],
        },
      },
      select: {
        case_id: true,
        case_: {
          select: {
            patient_id: true,
          },
        },
      },
    });
    expect(communicationRequestFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [
            {
              OR: expect.arrayContaining([
                { case_id: { in: ['case_1'] } },
                { related_entity_type: 'patient', related_entity_id: { in: ['patient_1'] } },
              ]),
            },
          ],
        }),
      }),
    );
    const body = await response.json();
    expect(body.data.requests).toHaveLength(1);
    expect(body.data.events).toHaveLength(0);
  });

  it('returns 404 when professional not found', async () => {
    externalProfessionalFindFirstMock.mockResolvedValue(null);

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'nonexistent' }),
    }))!;

    expect(response.status).toBe(404);
  });
});
