import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  communicationRequestFindFirstMock,
  communicationResponseFindManyMock,
  communicationResponseCreateMock,
  communicationRequestUpdateMock,
  careCaseFindFirstMock,
  patientFindFirstMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  communicationRequestFindFirstMock: vi.fn(),
  communicationResponseFindManyMock: vi.fn(),
  communicationResponseCreateMock: vi.fn(),
  communicationRequestUpdateMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
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
    careCase: {
      findFirst: careCaseFindFirstMock,
    },
    patient: {
      findFirst: patientFindFirstMock,
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

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

function createGetRequest(requestId = 'request_1') {
  return new NextRequest(`http://localhost/api/communication-requests/${requestId}/responses`);
}

function createPostRequest(body: unknown, requestId = 'request_1') {
  return new NextRequest(`http://localhost/api/communication-requests/${requestId}/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  } satisfies NextRequestInit);
}

function createMalformedJsonPostRequest(requestId = 'request_1') {
  return new NextRequest(`http://localhost/api/communication-requests/${requestId}/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"responder_name":',
  } satisfies NextRequestInit);
}

describe('/api/communication-requests/[id]/responses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'sent',
    });
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_1' });
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
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
    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'request_1' }),
    }))!;

    expect(response.status).toBe(200);
  });

  it('rejects blank request ids before listing responses', async () => {
    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '連携依頼IDが不正です',
    });
    expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(communicationResponseFindManyMock).not.toHaveBeenCalled();
  });

  it('creates a response and updates the request status', async () => {
    const response = (await POST(
      createPostRequest({
        responder_name: '医師A',
        content: '確認しました',
        responded_at: '2026-03-29',
      }),
      {
        params: Promise.resolve({ id: 'request_1' }),
      },
    ))!;

    expect(response.status).toBe(201);
    expect(communicationRequestUpdateMock).toHaveBeenCalledWith({
      where: { id: 'request_1' },
      data: { status: 'responded' },
    });
  });

  it('rejects blank request ids before creating a response', async () => {
    const response = (await POST(
      createPostRequest({
        responder_name: '医師A',
        content: '確認しました',
        responded_at: '2026-03-29',
      }),
      {
        params: Promise.resolve({ id: '   ' }),
      },
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '連携依頼IDが不正です',
    });
    expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateMock).not.toHaveBeenCalled();
  });

  it('normalizes response text fields before creating a response', async () => {
    const response = (await POST(
      createPostRequest({
        responder_name: ' 医師A ',
        content: ' 確認しました ',
        responded_at: ' 2026-03-29 ',
      }),
      {
        params: Promise.resolve({ id: 'request_1' }),
      },
    ))!;

    expect(response.status).toBe(201);
    expect(communicationResponseCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        responder_name: '医師A',
        content: '確認しました',
        responded_at: new Date('2026-03-29'),
      }),
    });
  });

  it('rejects blank response fields before loading the request', async () => {
    const response = (await POST(
      createPostRequest({
        responder_name: '   ',
        content: '   ',
        responded_at: '2026-03-29',
      }),
      {
        params: Promise.resolve({ id: 'request_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects non-object request bodies before loading the request', async () => {
    const response = (await POST(createPostRequest(['unexpected']), {
      params: Promise.resolve({ id: 'request_1' }),
    }))!;

    expect(response.status).toBe(400);
    expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON request bodies before loading the request', async () => {
    const response = (await POST(createMalformedJsonPostRequest(), {
      params: Promise.resolve({ id: 'request_1' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateMock).not.toHaveBeenCalled();
  });

  it('lets an org-wide role create a response without assignment scoping', async () => {
    careCaseFindFirstMock.mockResolvedValue(null);

    const response = (await POST(
      createPostRequest({
        responder_name: '医師A',
        content: '確認しました',
        responded_at: '2026-03-29',
      }),
      {
        params: Promise.resolve({ id: 'request_1' }),
      },
    ))!;

    expect(response.status).toBe(201);
    expect(communicationResponseCreateMock).toHaveBeenCalled();
    expect(communicationRequestUpdateMock).toHaveBeenCalled();
  });
});
