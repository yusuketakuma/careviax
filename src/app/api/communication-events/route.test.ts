import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: { orgId: string; userId: string; role: 'pharmacist' },
    ) => Promise<Response>,
  ) => {
    return (req: NextRequest) =>
      handler(req, {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      });
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

import { GET as rawGET, POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };

const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function createGetRequest(query = 'patient_id=patient_1') {
  return new NextRequest(`http://localhost/api/communication-events?${query}`);
}

function createPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/communication-events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonPostRequest() {
  return new NextRequest('http://localhost/api/communication-events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"event_type":',
  });
}

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
    const response = (await GET(createGetRequest()))!;

    expect(response.status).toBe(200);
    expect(communicationEventFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          patient_id: 'patient_1',
        }),
      }),
    );
    expect(communicationEventFindManyMock.mock.calls[0][0].where).not.toHaveProperty('AND');
  });

  it('lets an org-wide role create an event for any in-org case without assignment scoping', async () => {
    careCaseFindFirstMock.mockResolvedValue(null);

    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_2',
        case_id: 'case_2',
        event_type: 'fax',
        channel: 'fax',
        direction: 'outbound',
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(communicationEventCreateMock).toHaveBeenCalled();
    expect(learnContactProfileFromCommunicationMock).toHaveBeenCalled();
  });

  it('rejects non-object request bodies before assignment checks or create side effects', async () => {
    const response = (await POST(createPostRequest(['unexpected'])))!;

    expect(response.status).toBe(400);
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
    expect(learnContactProfileFromCommunicationMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON request bodies before assignment checks or create side effects', async () => {
    const response = (await POST(createMalformedJsonPostRequest()))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
    expect(learnContactProfileFromCommunicationMock).not.toHaveBeenCalled();
  });

  it('creates a communication event', async () => {
    const response = (await POST(
      createPostRequest({
        event_type: 'fax',
        channel: 'fax',
        direction: 'outbound',
      }),
    ))!;

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
