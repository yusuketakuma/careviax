import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

const {
  communicationRequestFindFirstMock,
  communicationResponseFindManyMock,
  communicationResponseFindFirstMock,
  communicationResponseCreateMock,
  communicationRequestUpdateManyMock,
  careCaseFindFirstMock,
  patientFindFirstMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  communicationRequestFindFirstMock: vi.fn(),
  communicationResponseFindManyMock: vi.fn(),
  communicationResponseFindFirstMock: vi.fn(),
  communicationResponseCreateMock: vi.fn(),
  communicationRequestUpdateManyMock: vi.fn(),
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

function buildUniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target: ['org_id', 'response_intent_key'] },
  });
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
    communicationResponseFindFirstMock.mockResolvedValue(null);
    communicationResponseCreateMock.mockResolvedValue({ id: 'response_2' });
    communicationRequestUpdateManyMock.mockResolvedValue({ count: 1 });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        communicationResponse: {
          findFirst: communicationResponseFindFirstMock,
          create: communicationResponseCreateMock,
        },
        communicationRequest: {
          updateMany: communicationRequestUpdateManyMock,
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
    expect(communicationRequestUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'request_1',
        org_id: 'org_1',
        status: 'sent',
      },
      data: { status: 'responded' },
    });
    expect(communicationResponseCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        request_id: 'request_1',
        responder_name: '医師A',
        content: '確認しました',
        responded_at: new Date('2026-03-29'),
        response_intent_key: expect.stringMatching(/^communication-response:v1:[a-f0-9]{64}$/),
      }),
    });
  });

  it('rejects archived patients before creating response records or updating request status', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      archived_at: new Date('2026-06-01T00:00:00.000Z'),
    });

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

    expect(response.status).toBe(409);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
  });

  it('returns conflict without creating a response when the request status changes concurrently', async () => {
    communicationRequestUpdateManyMock.mockResolvedValueOnce({ count: 0 });

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

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '連携依頼が同時に更新されました。再読み込みしてください',
    });
    expect(communicationRequestUpdateManyMock).toHaveBeenCalledTimes(1);
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
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
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
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

  it('returns an existing response for the same retry payload without creating another row', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'responded',
    });
    communicationResponseFindFirstMock.mockResolvedValue({
      id: 'response_existing',
      org_id: 'org_1',
      request_id: 'request_1',
      responder_name: '医師A',
      content: '確認しました',
      responded_at: new Date('2026-03-29'),
    });

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

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { id: 'response_existing' },
    });
    expect(communicationResponseFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        request_id: 'request_1',
        OR: [
          {
            response_intent_key: expect.stringMatching(/^communication-response:v1:[a-f0-9]{64}$/),
          },
          {
            response_intent_key: null,
            responder_name: '医師A',
            content: '確認しました',
            responded_at: new Date('2026-03-29'),
          },
        ],
      },
    });
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
  });

  it('returns the concurrently inserted response when the response intent key wins the race', async () => {
    communicationResponseFindFirstMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'response_race',
      org_id: 'org_1',
      request_id: 'request_1',
      responder_name: '医師A',
      content: '確認しました',
      responded_at: new Date('2026-03-29'),
    });
    communicationResponseCreateMock.mockRejectedValueOnce(buildUniqueConstraintError());

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

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { id: 'response_race' },
    });
    expect(communicationResponseCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        response_intent_key: expect.stringMatching(/^communication-response:v1:[a-f0-9]{64}$/),
      }),
    });
    const createData = communicationResponseCreateMock.mock.calls[0]?.[0]?.data;
    expect(communicationResponseFindFirstMock).toHaveBeenLastCalledWith({
      where: {
        org_id: 'org_1',
        request_id: 'request_1',
        response_intent_key: createData.response_intent_key,
      },
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
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
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
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
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
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
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
    expect(communicationRequestUpdateManyMock).toHaveBeenCalled();
  });
});
