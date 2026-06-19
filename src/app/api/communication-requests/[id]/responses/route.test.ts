import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

const {
  communicationRequestFindFirstMock,
  communicationResponseFindManyMock,
  communicationResponseFindFirstMock,
  communicationResponseCreateMock,
  communicationRequestUpdateManyMock,
  communicationRequestTxFindFirstMock,
  auditLogCreateMock,
  careCaseFindFirstMock,
  patientFindFirstMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  communicationRequestFindFirstMock: vi.fn(),
  communicationResponseFindManyMock: vi.fn(),
  communicationResponseFindFirstMock: vi.fn(),
  communicationResponseCreateMock: vi.fn(),
  communicationRequestUpdateManyMock: vi.fn(),
  communicationRequestTxFindFirstMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
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
    return (
      req: NextRequest & { role?: string },
      routeContext: { params: Promise<{ id: string }> },
    ) =>
      handler(
        req,
        { orgId: 'org_1', userId: 'user_1', role: req.role ?? 'pharmacist' },
        routeContext,
      );
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
      findFirst: communicationResponseFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];
const REQUEST_UPDATED_AT = new Date('2026-03-28T09:00:00.000Z');
const REQUEST_UPDATED_AT_ISO = REQUEST_UPDATED_AT.toISOString();

function createGetRequest(requestId = 'request_1') {
  return new NextRequest(`http://localhost/api/communication-requests/${requestId}/responses`);
}

function createPostRequest(body: unknown, requestId = 'request_1') {
  const effectiveBody =
    typeof body === 'object' &&
    body !== null &&
    !Array.isArray(body) &&
    !('expected_updated_at' in body)
      ? { expected_updated_at: REQUEST_UPDATED_AT_ISO, ...body }
      : body;
  return new NextRequest(`http://localhost/api/communication-requests/${requestId}/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(effectiveBody),
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
      updated_at: REQUEST_UPDATED_AT,
      related_entity_type: null,
    });
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_1' });
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    communicationResponseFindManyMock.mockResolvedValue([{ id: 'response_1' }]);
    communicationResponseFindFirstMock.mockResolvedValue(null);
    communicationResponseCreateMock.mockResolvedValue({ id: 'response_2' });
    communicationRequestUpdateManyMock.mockResolvedValue({ count: 1 });
    communicationRequestTxFindFirstMock.mockResolvedValue({
      updated_at: new Date('2026-03-28T09:01:00.000Z'),
    });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        communicationResponse: {
          findFirst: communicationResponseFindFirstMock,
          create: communicationResponseCreateMock,
        },
        communicationRequest: {
          updateMany: communicationRequestUpdateManyMock,
          findFirst: communicationRequestTxFindFirstMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('lists responses for a communication request', async () => {
    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'request_1' }),
    }))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'response_1' }],
      request_updated_at: REQUEST_UPDATED_AT_ISO,
    });
    expect(communicationResponseFindManyMock).toHaveBeenCalledWith({
      where: { request_id: 'request_1', org_id: 'org_1' },
      orderBy: [{ responded_at: 'desc' }, { id: 'desc' }],
    });
  });

  it('rejects care report response reads when the caller cannot send reports', async () => {
    communicationRequestFindFirstMock.mockResolvedValueOnce({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'sent',
      updated_at: REQUEST_UPDATED_AT,
      related_entity_type: 'care_report',
    });

    const response = (await GET(Object.assign(createGetRequest(), { role: 'clerk' }), {
      params: Promise.resolve({ id: 'request_1' }),
    }))!;

    expect(response.status).toBe(403);
    expect(communicationResponseFindManyMock).not.toHaveBeenCalled();
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
        responded_at: '2026-03-29T00:00:00.000Z',
      }),
      {
        params: Promise.resolve({ id: 'request_1' }),
      },
    ))!;

    expect(response.status).toBe(201);
    await expect(response.clone().json()).resolves.toMatchObject({
      data: { id: 'response_2' },
      request_updated_at: '2026-03-28T09:01:00.000Z',
    });
    expect(communicationRequestUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'request_1',
        org_id: 'org_1',
        status: 'sent',
        updated_at: REQUEST_UPDATED_AT,
      },
      data: { status: 'responded' },
    });
    expect(communicationResponseCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        request_id: 'request_1',
        responder_name: '医師A',
        content: '確認しました',
        responded_at: new Date('2026-03-29T00:00:00.000Z'),
        response_intent_key: expect.stringMatching(/^communication-response:v2:[a-f0-9]{64}$/),
      }),
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'communication_response_recorded',
        target_type: 'communication_request',
        target_id: 'request_1',
        changes: expect.objectContaining({
          from_status: 'sent',
          to_status: 'responded',
          response_id: 'response_2',
          response_created: true,
          response_intent_key: expect.stringMatching(/^communication-response:v2:[a-f0-9]{64}$/),
          responder_name: '医師A',
          response_content_digest: expect.stringMatching(
            /^communication-response-content:v1:[a-f0-9]{64}$/,
          ),
          response_content_length: 6,
          responded_at: '2026-03-29T00:00:00.000Z',
          actor_id: 'user_1',
        }),
      }),
    });
    expect(JSON.stringify(auditLogCreateMock.mock.calls[0]?.[0]?.data.changes)).not.toContain(
      '確認しました',
    );
  });

  it('rejects care report response writes when the caller cannot send reports', async () => {
    communicationRequestFindFirstMock.mockResolvedValueOnce({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'sent',
      related_entity_type: 'care_report',
    });

    const response = (await POST(
      Object.assign(
        createPostRequest({
          responder_name: '医師A',
          content: '確認しました',
          responded_at: '2026-03-29T00:00:00.000Z',
        }),
        { role: 'clerk' },
      ),
      {
        params: Promise.resolve({ id: 'request_1' }),
      },
    ))!;

    expect(response.status).toBe(403);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
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
        responded_at: '2026-03-29T00:00:00.000Z',
      }),
      {
        params: Promise.resolve({ id: 'request_1' }),
      },
    ))!;

    expect(response.status).toBe(409);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns conflict without creating a response when the request status changes concurrently', async () => {
    communicationRequestUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = (await POST(
      createPostRequest({
        responder_name: '医師A',
        content: '確認しました',
        responded_at: '2026-03-29T00:00:00.000Z',
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

  it('requires the request version before creating a response', async () => {
    const response = (await POST(
      createPostRequest({
        expected_updated_at: undefined,
        responder_name: '医師A',
        content: '確認しました',
        responded_at: '2026-03-29T00:00:00.000Z',
      }),
      {
        params: Promise.resolve({ id: 'request_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        expected_updated_at: expect.any(Array),
      },
    });
    expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects stale response creation before updating request status', async () => {
    const response = (await POST(
      createPostRequest({
        expected_updated_at: '2026-03-28T08:00:00.000Z',
        responder_name: '医師A',
        content: '確認しました',
        responded_at: '2026-03-29T00:00:00.000Z',
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
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
  });

  it('replays an existing response when a successful retry carries the original version', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'responded',
      updated_at: new Date('2026-03-28T09:01:00.000Z'),
      related_entity_type: null,
    });
    communicationResponseFindFirstMock.mockResolvedValueOnce({
      id: 'response_existing',
      org_id: 'org_1',
      request_id: 'request_1',
      responder_name: '医師A',
      content: '確認しました',
      responded_at: new Date('2026-03-29T00:00:00.000Z'),
    });

    const response = (await POST(
      createPostRequest({
        responder_name: '医師A',
        content: '確認しました',
        responded_at: '2026-03-29T00:00:00.000Z',
      }),
      {
        params: Promise.resolve({ id: 'request_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { id: 'response_existing' },
      request_updated_at: '2026-03-28T09:01:00.000Z',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects non-datetime responded_at values before loading the request', async () => {
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

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        responded_at: expect.any(Array),
      },
    });
    expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects response content above the clinical note length cap before loading the request', async () => {
    const response = (await POST(
      createPostRequest({
        responder_name: '医師A',
        content: 'あ'.repeat(4001),
        responded_at: '2026-03-29T00:00:00.000Z',
      }),
      {
        params: Promise.resolve({ id: 'request_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        content: expect.any(Array),
      },
    });
    expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
  });

  it('rejects blank request ids before creating a response', async () => {
    const response = (await POST(
      createPostRequest({
        responder_name: '医師A',
        content: '確認しました',
        responded_at: '2026-03-29T00:00:00.000Z',
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
        responded_at: ' 2026-03-29T00:00:00.000Z ',
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
        responded_at: new Date('2026-03-29T00:00:00.000Z'),
      }),
    });
  });

  it('returns an existing response for the same retry payload without creating another row', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'responded',
      updated_at: REQUEST_UPDATED_AT,
      related_entity_type: null,
    });
    communicationResponseFindFirstMock.mockResolvedValue({
      id: 'response_existing',
      org_id: 'org_1',
      request_id: 'request_1',
      responder_name: '医師A',
      content: '確認しました',
      responded_at: new Date('2026-03-29T00:00:00.000Z'),
    });
    communicationRequestTxFindFirstMock.mockResolvedValue({
      updated_at: REQUEST_UPDATED_AT,
    });

    const response = (await POST(
      createPostRequest({
        responder_name: '医師A',
        content: '確認しました',
        responded_at: '2026-03-29T00:00:00.000Z',
      }),
      {
        params: Promise.resolve({ id: 'request_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { id: 'response_existing' },
      request_updated_at: REQUEST_UPDATED_AT_ISO,
    });
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(communicationRequestTxFindFirstMock).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'request_1',
        org_id: 'org_1',
      },
      select: { updated_at: true },
    });
    const query = communicationResponseFindFirstMock.mock.calls[0]?.[0];
    expect(query?.where).toMatchObject({
      org_id: 'org_1',
      request_id: 'request_1',
    });
    expect(query?.where.OR[0].response_intent_key).toEqual(
      expect.stringMatching(/^communication-response:v2:[a-f0-9]{64}$/),
    );
    expect(query?.where.OR[1].response_intent_key).toEqual(
      expect.stringMatching(/^communication-response:v1:[a-f0-9]{64}$/),
    );
    expect(query?.where.OR[2]).toMatchObject({
      response_intent_key: null,
      responder_name: '医師A',
      content: '確認しました',
      responded_at: new Date('2026-03-29T00:00:00.000Z'),
    });
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('touches and audits an already-responded request when a different new response is recorded', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'responded',
      updated_at: REQUEST_UPDATED_AT,
      related_entity_type: null,
    });
    communicationResponseFindFirstMock.mockResolvedValue(null);
    communicationResponseCreateMock.mockResolvedValue({ id: 'response_new' });
    communicationRequestTxFindFirstMock.mockResolvedValue({
      updated_at: new Date('2026-03-28T09:02:00.000Z'),
    });

    const response = (await POST(
      createPostRequest({
        responder_name: '薬剤部B',
        content: '追加確認しました',
        responded_at: '2026-03-29T00:05:00.000Z',
      }),
      {
        params: Promise.resolve({ id: 'request_1' }),
      },
    ))!;

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      data: { id: 'response_new' },
      request_updated_at: '2026-03-28T09:02:00.000Z',
    });
    expect(communicationRequestUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'request_1',
        org_id: 'org_1',
        status: 'responded',
        updated_at: REQUEST_UPDATED_AT,
      },
      data: { updated_at: expect.any(Date) },
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'communication_response_recorded',
        changes: expect.objectContaining({
          from_status: 'responded',
          to_status: 'responded',
          response_id: 'response_new',
          response_created: true,
          response_content_digest: expect.stringMatching(
            /^communication-response-content:v1:[a-f0-9]{64}$/,
          ),
          response_content_length: 8,
        }),
      }),
    });
  });

  it('returns the concurrently inserted response when the response intent key wins the race', async () => {
    communicationResponseFindFirstMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'response_race',
      org_id: 'org_1',
      request_id: 'request_1',
      responder_name: '医師A',
      content: '確認しました',
      responded_at: new Date('2026-03-29T00:00:00.000Z'),
    });
    communicationResponseCreateMock.mockRejectedValueOnce(buildUniqueConstraintError());

    const response = (await POST(
      createPostRequest({
        responder_name: '医師A',
        content: '確認しました',
        responded_at: '2026-03-29T00:00:00.000Z',
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
        response_intent_key: expect.stringMatching(/^communication-response:v2:[a-f0-9]{64}$/),
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
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'communication_response_recorded',
        target_type: 'communication_request',
        target_id: 'request_1',
        changes: expect.objectContaining({
          from_status: 'sent',
          to_status: 'responded',
          response_id: 'response_race',
          response_created: false,
          response_intent_key: expect.stringMatching(/^communication-response:v2:[a-f0-9]{64}$/),
          response_content_digest: expect.stringMatching(
            /^communication-response-content:v1:[a-f0-9]{64}$/,
          ),
          response_content_length: 6,
        }),
      }),
    });
    expect(JSON.stringify(auditLogCreateMock.mock.calls[0]?.[0]?.data.changes)).not.toContain(
      '確認しました',
    );
  });

  it('returns the concurrently inserted response without a duplicate audit when already responded', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'responded',
      updated_at: REQUEST_UPDATED_AT,
      related_entity_type: null,
    });
    communicationResponseFindFirstMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'response_race',
        org_id: 'org_1',
        request_id: 'request_1',
        responder_name: '医師A',
        content: '確認しました',
        responded_at: new Date('2026-03-29T00:00:00.000Z'),
      });
    communicationResponseCreateMock.mockRejectedValueOnce(buildUniqueConstraintError());
    communicationRequestTxFindFirstMock.mockResolvedValue({
      updated_at: REQUEST_UPDATED_AT,
    });

    const response = (await POST(
      createPostRequest({
        responder_name: '医師A',
        content: '確認しました',
        responded_at: '2026-03-29T00:00:00.000Z',
      }),
      {
        params: Promise.resolve({ id: 'request_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { id: 'response_race' },
      request_updated_at: REQUEST_UPDATED_AT_ISO,
    });
    expect(communicationRequestUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'request_1',
        org_id: 'org_1',
        status: 'responded',
        updated_at: REQUEST_UPDATED_AT,
      },
      data: { updated_at: expect.any(Date) },
    });
    expect(communicationResponseCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        response_intent_key: expect.stringMatching(/^communication-response:v2:[a-f0-9]{64}$/),
      }),
    });
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects blank response fields before loading the request', async () => {
    const response = (await POST(
      createPostRequest({
        responder_name: '   ',
        content: '   ',
        responded_at: '2026-03-29T00:00:00.000Z',
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
        responded_at: '2026-03-29T00:00:00.000Z',
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
