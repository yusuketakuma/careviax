import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  communicationEventFindManyMock,
  communicationEventCreateMock,
  patientFindManyMock,
  careCaseFindManyMock,
  careCaseFindFirstMock,
  learnContactProfileFromCommunicationMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  communicationEventFindManyMock: vi.fn(),
  communicationEventCreateMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  learnContactProfileFromCommunicationMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (
    handler: (
      req: NextRequest & { orgId: string; userId: string; role: 'pharmacist' },
    ) => Promise<Response>,
  ) => {
    return (req: NextRequest) =>
      handler({
        ...req,
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      } as unknown as NextRequest & { orgId: string; userId: string; role: 'pharmacist' });
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    communicationEvent: {
      findMany: communicationEventFindManyMock,
    },
    patient: {
      findMany: patientFindManyMock,
      findFirst: vi.fn(),
    },
    careCase: {
      findMany: careCaseFindManyMock,
      findFirst: careCaseFindFirstMock,
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
    patientFindManyMock.mockResolvedValue([{ id: 'patient_1' }]);
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1' }]);
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_1' });
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
    expect(communicationEventFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [
            expect.objectContaining({
              OR: expect.arrayContaining([
                { case_id: { in: ['case_1'] } },
                { AND: [{ case_id: null }, { patient_id: { in: ['patient_1'] } }] },
              ]),
            }),
          ],
        }),
      }),
    );
  });

  it('rejects an unassigned case before create and contact-learning side effects', async () => {
    careCaseFindFirstMock.mockResolvedValue(null);

    const response = (await POST({
      json: async () => ({
        patient_id: 'patient_2',
        case_id: 'case_2',
        event_type: 'fax',
        channel: 'fax',
        direction: 'outbound',
      }),
    } as NextRequest))!;

    expect(response.status).toBe(400);
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
    expect(learnContactProfileFromCommunicationMock).not.toHaveBeenCalled();
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
    expect(learnContactProfileFromCommunicationMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'org_1',
      counterpartName: undefined,
      counterpartContact: undefined,
      channel: 'fax',
      occurredAt: expect.anything(),
      markSuccess: true,
    });
  });
});
