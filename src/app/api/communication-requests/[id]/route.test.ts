import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  requireAuthContextMock,
  communicationRequestFindFirstMock,
  communicationRequestTxFindFirstMock,
  communicationRequestUpdateManyMock,
  communicationResponseFindFirstMock,
  communicationResponseCreateMock,
  tracingReportFindFirstMock,
  tracingReportUpdateManyMock,
  auditLogCreateMock,
  careCaseFindFirstMock,
  patientFindFirstMock,
  fetchEmergencyContactsMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  communicationRequestFindFirstMock: vi.fn(),
  communicationRequestTxFindFirstMock: vi.fn(),
  communicationRequestUpdateManyMock: vi.fn(),
  communicationResponseFindFirstMock: vi.fn(),
  communicationResponseCreateMock: vi.fn(),
  tracingReportFindFirstMock: vi.fn(),
  tracingReportUpdateManyMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  fetchEmergencyContactsMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    communicationRequest: {
      findFirst: communicationRequestFindFirstMock,
    },
    tracingReport: {
      findFirst: tracingReportFindFirstMock,
    },
    careCase: {
      findFirst: careCaseFindFirstMock,
    },
    patient: {
      findFirst: patientFindFirstMock,
    },
    communicationResponse: {
      findFirst: communicationResponseFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/patient/emergency-contacts', () => ({
  fetchEmergencyContacts: fetchEmergencyContactsMock,
}));

import { GET, PATCH } from './route';

const CURRENT_UPDATED_AT = '2026-06-18T00:00:00.000Z';
const CURRENT_UPDATED_AT_DATE = new Date(CURRENT_UPDATED_AT);
const HOSTILE_TRACING_REPORT_ID = 'tracing/with space%2F?x=#';
const HOSTILE_TRACING_REPORT_PDF_URL =
  '/api/tracing-reports/tracing%2Fwith%20space%252F%3Fx%3D%23/pdf';

function createGetRequest() {
  return new NextRequest('http://localhost/api/communication-requests/request_1');
}

function createRequest(body: unknown, headers?: Record<string, string>) {
  const requestBody =
    typeof body === 'object' &&
    body !== null &&
    !Array.isArray(body) &&
    !('expected_updated_at' in body)
      ? { expected_updated_at: CURRENT_UPDATED_AT, ...body }
      : body;
  return new NextRequest('http://localhost/api/communication-requests/request_1', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      ...(headers ?? {}),
    },
    body: JSON.stringify(requestBody),
  });
}

function createMalformedJsonRequest(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/communication-requests/request_1', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      ...(headers ?? {}),
    },
    body: '{"status":',
  });
}

function buildUniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target: ['org_id', 'response_intent_key'] },
  });
}

describe('/api/communication-requests/[id] GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_1' });
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    fetchEmergencyContactsMock.mockResolvedValue([{ id: 'contact_1', name: '家族A' }]);
  });

  it('loads request content and suggested contacts after assignment access succeeds', async () => {
    communicationRequestFindFirstMock
      .mockResolvedValueOnce({
        id: 'request_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
      })
      .mockResolvedValueOnce({
        id: 'request_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        subject: '確認事項',
        content: '処方内容を確認したいです',
        responses: [{ id: 'response_1', content: '承知しました' }],
      });

    const response = await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'request_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'request_1',
        subject: '確認事項',
        suggested_contacts: [{ id: 'contact_1', name: '家族A' }],
      },
    });
    expect(communicationRequestFindFirstMock).toHaveBeenNthCalledWith(1, {
      where: { id: 'request_1', org_id: 'org_1' },
      select: {
        id: true,
        patient_id: true,
        case_id: true,
        related_entity_type: true,
      },
    });
    expect(communicationRequestFindFirstMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: 'request_1', org_id: 'org_1' },
        select: expect.objectContaining({
          subject: true,
          content: true,
          responses: expect.objectContaining({
            orderBy: [{ responded_at: 'desc' }, { id: 'desc' }],
            select: expect.objectContaining({ content: true }),
          }),
        }),
      }),
    );
    expect(fetchEmergencyContactsMock).toHaveBeenCalledWith(
      expect.anything(),
      'org_1',
      'patient_1',
    );
  });

  it('rejects blank request ids before loading communication content', async () => {
    const response = await GET(createGetRequest(), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '連携依頼IDが不正です',
    });
    expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(fetchEmergencyContactsMock).not.toHaveBeenCalled();
  });

  it('rejects care report communication content for callers without report send permission', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      ctx: {
        orgId: 'org_1',
        userId: 'clerk_1',
        role: 'clerk',
      },
    });
    communicationRequestFindFirstMock.mockResolvedValueOnce({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      related_entity_type: 'care_report',
    });

    const response = await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'request_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(communicationRequestFindFirstMock).toHaveBeenCalledTimes(1);
    expect(fetchEmergencyContactsMock).not.toHaveBeenCalled();
  });

  it('loads communication content for an org-wide role regardless of case assignment', async () => {
    communicationRequestFindFirstMock
      .mockResolvedValueOnce({
        id: 'request_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
      })
      .mockResolvedValueOnce({
        id: 'request_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        subject: '確認事項',
        content: '処方内容を確認したいです',
        responses: [],
      });
    careCaseFindFirstMock.mockResolvedValue(null);

    const response = await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'request_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({
      data: { id: 'request_1', subject: '確認事項' },
    });
    expect(communicationRequestFindFirstMock).toHaveBeenCalledTimes(2);
    expect(communicationRequestFindFirstMock).toHaveBeenNthCalledWith(1, {
      where: { id: 'request_1', org_id: 'org_1' },
      select: {
        id: true,
        patient_id: true,
        case_id: true,
        related_entity_type: true,
      },
    });
    expect(fetchEmergencyContactsMock).toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when request lookup fails unexpectedly', async () => {
    communicationRequestFindFirstMock.mockRejectedValueOnce(
      new Error('患者 山田花子 090-1234-5678 raw care coordination detail'),
    );

    const response = await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'request_1' }),
    });

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');

    const json = await response.json();
    expect(json).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(json)).not.toContain('山田花子');
    expect(JSON.stringify(json)).not.toContain('090-1234-5678');
    expect(JSON.stringify(json)).not.toContain('raw care coordination detail');
  });
});

describe('/api/communication-requests/[id] PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'received',
      updated_at: CURRENT_UPDATED_AT_DATE,
      recipient_name: '在宅主治医',
      related_entity_type: null,
      related_entity_id: null,
    });
    tracingReportFindFirstMock.mockResolvedValue({
      id: 'tracing_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'received',
      sent_at: new Date('2026-03-28T05:00:00.000Z'),
      acknowledged_at: null,
    });
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_1' });
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    communicationRequestTxFindFirstMock.mockResolvedValue({
      id: 'request_1',
      status: 'responded',
      responses: [],
    });
    communicationRequestUpdateManyMock.mockResolvedValue({ count: 1 });
    communicationResponseFindFirstMock.mockResolvedValue(null);
    communicationResponseCreateMock.mockResolvedValue({ id: 'response_1' });
    tracingReportUpdateManyMock.mockResolvedValue({ count: 1 });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        communicationRequest: {
          updateMany: communicationRequestUpdateManyMock,
          findFirst: communicationRequestTxFindFirstMock,
        },
        communicationResponse: {
          findFirst: communicationResponseFindFirstMock,
          create: communicationResponseCreateMock,
        },
        tracingReport: {
          updateMany: tracingReportUpdateManyMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('returns a sanitized no-store 500 when auth context fails before mutation work', async () => {
    requireAuthContextMock.mockRejectedValueOnce(
      new Error('患者 山田花子 090-1234-5678 communication update raw detail'),
    );

    const response = await PATCH(
      createRequest(
        { status: 'in_progress', status_change_reason: '電話で受領確認し対応を開始' },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);

    const json = await response.json();
    expect(json).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(json)).not.toContain('山田花子');
    expect(JSON.stringify(json)).not.toContain('090-1234-5678');
    expect(JSON.stringify(json)).not.toContain('communication update raw detail');
    expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects care report communication mutations for callers without report send permission', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      ctx: {
        orgId: 'org_1',
        userId: 'clerk_1',
        role: 'clerk',
      },
    });
    communicationRequestFindFirstMock.mockResolvedValueOnce({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'sent',
      updated_at: CURRENT_UPDATED_AT_DATE,
      related_entity_type: 'care_report',
      related_entity_id: 'report_1',
    });

    const response = await PATCH(
      createRequest({
        status: 'responded',
        status_change_reason: '医師から返信あり',
      }),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects invalid status transitions', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      status: 'draft',
      updated_at: CURRENT_UPDATED_AT_DATE,
    });

    const response = await PATCH(
      createRequest(
        { status: 'received', status_change_reason: '受領確認として更新' },
        { 'x-org-id': 'org_1' },
      ),
      {
        params: Promise.resolve({ id: 'request_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'draft から received へは遷移できません',
    });
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
  });

  it('requires a reason for direct status changes', async () => {
    const response = await PATCH(
      createRequest({ status: 'in_progress' }, { 'x-org-id': 'org_1' }),
      {
        params: Promise.resolve({ id: 'request_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'ステータス変更理由は必須です',
    });
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('requires expected_updated_at before loading the request for mutation work', async () => {
    const response = await PATCH(
      createRequest(
        {
          expected_updated_at: undefined,
          status: 'in_progress',
          status_change_reason: '電話で受領確認し対応を開始',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
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
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns conflict for stale expected_updated_at before response or audit side effects', async () => {
    const response = await PATCH(
      createRequest(
        {
          expected_updated_at: '2026-06-17T23:59:59.000Z',
          response: {
            responder_name: '在宅主治医',
            content: '現行処方で継続',
          },
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '連携依頼が同時に更新されました。再読み込みしてください',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('replays an existing PATCH response when the retry carries the original version', async () => {
    communicationRequestFindFirstMock
      .mockResolvedValueOnce({
        id: 'request_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        status: 'responded',
        updated_at: new Date('2026-06-18T00:01:00.000Z'),
        related_entity_type: null,
        related_entity_id: null,
      })
      .mockResolvedValueOnce({
        id: 'request_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        status: 'responded',
        updated_at: new Date('2026-06-18T00:01:00.000Z'),
        responses: [{ id: 'response_existing' }],
      });
    communicationResponseFindFirstMock.mockResolvedValueOnce({
      id: 'response_existing',
      org_id: 'org_1',
      request_id: 'request_1',
      responder_name: '在宅主治医',
      content: '現行処方で継続',
      responded_at: new Date('2026-03-29T00:00:00.000Z'),
    });

    const response = await PATCH(
      createRequest(
        {
          expected_updated_at: CURRENT_UPDATED_AT,
          response: {
            responder_name: '在宅主治医',
            content: '現行処方で継続',
            responded_at: '2026-03-29T00:00:00.000Z',
          },
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'request_1',
        responses: [{ id: 'response_existing' }],
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects non-object request bodies before loading the request', async () => {
    const response = await PATCH(createRequest(['unexpected'], { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'request_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects blank request ids before loading or updating the request', async () => {
    const response = await PATCH(
      createRequest(
        { status: 'in_progress', status_change_reason: '電話で受領確認し対応を開始' },
        { 'x-org-id': 'org_1' },
      ),
      {
        params: Promise.resolve({ id: '   ' }),
      },
    );

    if (!response) throw new Error('response is required');
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
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON request bodies before loading the request', async () => {
    const response = await PATCH(createMalformedJsonRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'request_1' }),
    });

    if (!response) throw new Error('response is required');
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
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects blank response fields before loading the request', async () => {
    const response = await PATCH(
      createRequest(
        {
          response: {
            responder_name: '   ',
            content: '   ',
            responded_at: '   ',
          },
        },
        { 'x-org-id': 'org_1' },
      ),
      {
        params: Promise.resolve({ id: 'request_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects response content above the clinical note length cap before loading the request', async () => {
    const response = await PATCH(
      createRequest(
        {
          response: {
            responder_name: '在宅主治医',
            content: 'あ'.repeat(4001),
            responded_at: '2026-03-29T00:00:00.000Z',
          },
        },
        { 'x-org-id': 'org_1' },
      ),
      {
        params: Promise.resolve({ id: 'request_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        response: expect.any(Array),
      },
    });
    expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
  });

  it('records an audit log with the reason for direct status changes', async () => {
    const response = await PATCH(
      createRequest(
        { status: ' in_progress ', status_change_reason: ' 電話で受領確認し対応を開始 ' },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(communicationRequestUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'request_1',
        org_id: 'org_1',
        status: 'received',
        updated_at: CURRENT_UPDATED_AT_DATE,
      },
      data: { status: 'in_progress' },
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'communication_request_status_changed',
        target_type: 'communication_request',
        target_id: 'request_1',
        changes: expect.objectContaining({
          from_status: 'received',
          to_status: 'in_progress',
          reason: '電話で受領確認し対応を開始',
        }),
      }),
    });
  });

  it('returns a sanitized no-store 500 when the update transaction fails unexpectedly', async () => {
    withOrgContextMock.mockRejectedValueOnce(
      new Error('患者 山田花子 090-1234-5678 raw transaction detail'),
    );

    const response = await PATCH(
      createRequest(
        { status: 'in_progress', status_change_reason: '電話で受領確認し対応を開始' },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);

    const json = await response.json();
    expect(json).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(json)).not.toContain('山田花子');
    expect(JSON.stringify(json)).not.toContain('090-1234-5678');
    expect(JSON.stringify(json)).not.toContain('raw transaction detail');
  });

  it('rejects archived patients before request update, response creation, tracing sync, or audit', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      archived_at: new Date('2026-06-01T00:00:00.000Z'),
    });

    const response = await PATCH(
      createRequest(
        { status: 'in_progress', status_change_reason: '電話で受領確認し対応を開始' },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(tracingReportUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('records a response and auto-advances to responded', async () => {
    const response = await PATCH(
      createRequest(
        {
          response: {
            responder_name: ' 在宅主治医 ',
            content: ' 現行処方で継続 ',
          },
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(communicationResponseCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        request_id: 'request_1',
        responder_name: '在宅主治医',
        content: '現行処方で継続',
        response_intent_key: expect.stringMatching(/^communication-response:v2:[a-f0-9]{64}$/),
      }),
    });
    expect(communicationRequestUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'request_1',
        org_id: 'org_1',
        status: 'received',
        updated_at: CURRENT_UPDATED_AT_DATE,
      },
      data: { status: 'responded' },
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'communication_request_status_changed',
        changes: expect.objectContaining({
          from_status: 'received',
          to_status: 'responded',
          reason: 'communication_response_recorded',
          response_id: 'response_1',
        }),
      }),
    });
  });

  it('returns conflict without creating a response when the request status changes concurrently', async () => {
    communicationRequestUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await PATCH(
      createRequest(
        {
          response: {
            responder_name: '在宅主治医',
            content: '現行処方で継続',
          },
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '連携依頼が同時に更新されました。再読み込みしてください',
    });
    expect(communicationRequestUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'request_1',
        org_id: 'org_1',
        status: 'received',
        updated_at: CURRENT_UPDATED_AT_DATE,
      },
      data: { status: 'responded' },
    });
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestTxFindFirstMock).not.toHaveBeenCalled();
    expect(tracingReportUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('reuses an existing response for the same retry payload without creating another row', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'responded',
      updated_at: CURRENT_UPDATED_AT_DATE,
      related_entity_type: null,
      related_entity_id: null,
    });
    communicationResponseFindFirstMock.mockResolvedValue({
      id: 'response_existing',
      org_id: 'org_1',
      request_id: 'request_1',
      responder_name: '在宅主治医',
      content: '現行処方で継続',
      responded_at: new Date('2026-03-29T00:00:00.000Z'),
    });

    const response = await PATCH(
      createRequest(
        {
          response: {
            responder_name: '在宅主治医',
            content: '現行処方で継続',
            responded_at: '2026-03-29T00:00:00.000Z',
          },
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
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
      responder_name: '在宅主治医',
      content: '現行処方で継続',
      responded_at: new Date('2026-03-29T00:00:00.000Z'),
    });
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('touches and audits an already-responded request when PATCH records a different new response', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'responded',
      updated_at: CURRENT_UPDATED_AT_DATE,
      related_entity_type: null,
      related_entity_id: null,
    });
    communicationResponseFindFirstMock.mockResolvedValue(null);
    communicationResponseCreateMock.mockResolvedValue({ id: 'response_new' });
    communicationRequestTxFindFirstMock.mockResolvedValue({
      id: 'request_1',
      status: 'responded',
      responses: [{ id: 'response_new' }],
    });

    const response = await PATCH(
      createRequest(
        {
          response: {
            responder_name: '薬剤部B',
            content: '追加確認しました',
            responded_at: '2026-03-29T00:05:00.000Z',
          },
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(communicationRequestUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'request_1',
        org_id: 'org_1',
        status: 'responded',
        updated_at: CURRENT_UPDATED_AT_DATE,
      },
      data: { updated_at: expect.any(Date) },
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'communication_response_recorded',
        target_type: 'communication_request',
        target_id: 'request_1',
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

  it('reuses an existing inline response retry even when responded_at was omitted', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'responded',
      updated_at: CURRENT_UPDATED_AT_DATE,
      related_entity_type: null,
      related_entity_id: null,
    });
    communicationResponseFindFirstMock.mockResolvedValue({
      id: 'response_existing',
      org_id: 'org_1',
      request_id: 'request_1',
      responder_name: '在宅主治医',
      content: '現行処方で継続',
      responded_at: new Date('2026-03-29T00:00:00.000Z'),
    });

    const response = await PATCH(
      createRequest(
        {
          response: {
            responder_name: '在宅主治医',
            content: '現行処方で継続',
          },
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
    const query = communicationResponseFindFirstMock.mock.calls[0]?.[0];
    const intentKey = query?.where.OR[0].response_intent_key;
    expect(intentKey).toEqual(expect.stringMatching(/^communication-response:v2:[a-f0-9]{64}$/));
    expect(query?.where.OR[1].response_intent_key).toEqual(
      expect.stringMatching(/^communication-response:v1:[a-f0-9]{64}$/),
    );
    expect(query).toMatchObject({
      where: {
        org_id: 'org_1',
        request_id: 'request_1',
        OR: [
          { response_intent_key: intentKey },
          {
            response_intent_key: query?.where.OR[1].response_intent_key,
          },
          {
            response_intent_key: null,
            responder_name: '在宅主治医',
            content: '現行処方で継続',
          },
        ],
      },
    });
    expect(query?.where.OR[2].responded_at).toBeInstanceOf(Date);
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns the concurrently inserted response when the PATCH response intent key wins the race', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'responded',
      updated_at: CURRENT_UPDATED_AT_DATE,
      related_entity_type: null,
      related_entity_id: null,
    });
    communicationResponseFindFirstMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'response_race',
        org_id: 'org_1',
        request_id: 'request_1',
        responder_name: '在宅主治医',
        content: '現行処方で継続',
        responded_at: new Date('2026-03-29T00:00:00.000Z'),
      });
    communicationResponseCreateMock.mockRejectedValueOnce(buildUniqueConstraintError());

    const response = await PATCH(
      createRequest(
        {
          response: {
            responder_name: '在宅主治医',
            content: '現行処方で継続',
            responded_at: '2026-03-29T00:00:00.000Z',
          },
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(communicationResponseCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        request_id: 'request_1',
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
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('updates and audits a linked tracing report only after scope consistency is verified', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'received',
      updated_at: CURRENT_UPDATED_AT_DATE,
      recipient_name: '在宅主治医',
      related_entity_type: 'tracing_report',
      related_entity_id: 'tracing_1',
    });
    communicationRequestTxFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      related_entity_type: 'tracing_report',
      related_entity_id: 'tracing_1',
      recipient_name: '在宅主治医',
      status: 'responded',
      responses: [],
    });

    const response = await PATCH(
      createRequest(
        {
          response: {
            responder_name: '在宅主治医',
            content: '現行処方で継続',
          },
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(tracingReportFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'tracing_1',
        org_id: 'org_1',
      },
      select: {
        id: true,
        patient_id: true,
        case_id: true,
        status: true,
        sent_at: true,
        acknowledged_at: true,
      },
    });
    expect(tracingReportUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'tracing_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        status: 'received',
        sent_at: new Date('2026-03-28T05:00:00.000Z'),
        acknowledged_at: null,
      },
      data: expect.objectContaining({
        status: 'acknowledged',
        sent_to_physician: '在宅主治医',
        pdf_url: '/api/tracing-reports/tracing_1/pdf',
      }),
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'tracing_report_status_changed',
        target_type: 'tracing_report',
        target_id: 'tracing_1',
        changes: expect.objectContaining({
          from_status: 'received',
          to_status: 'acknowledged',
          reason: 'communication_response_recorded',
          linked_communication_request_id: 'request_1',
          actor_id: 'user_1',
        }),
      }),
    });
    expect(auditLogCreateMock).not.toHaveBeenCalledWith({
      data: expect.objectContaining({
        changes: expect.objectContaining({
          reason: '現行処方で継続',
        }),
      }),
    });
  });

  it('returns conflict before response or audit side effects when the linked tracing report changes concurrently', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'received',
      updated_at: CURRENT_UPDATED_AT_DATE,
      recipient_name: '在宅主治医',
      related_entity_type: 'tracing_report',
      related_entity_id: 'tracing_1',
    });
    tracingReportUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await PATCH(
      createRequest(
        {
          response: {
            responder_name: '在宅主治医',
            content: '現行処方で継続',
          },
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '連携依頼が同時に更新されました。再読み込みしてください',
    });
    expect(communicationRequestUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'request_1',
        org_id: 'org_1',
        status: 'received',
        updated_at: CURRENT_UPDATED_AT_DATE,
      },
      data: { status: 'responded' },
    });
    expect(tracingReportUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'tracing_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        status: 'received',
        sent_at: new Date('2026-03-28T05:00:00.000Z'),
        acknowledged_at: null,
      },
      data: expect.objectContaining({
        status: 'acknowledged',
        sent_to_physician: '在宅主治医',
        pdf_url: '/api/tracing-reports/tracing_1/pdf',
      }),
    });
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestTxFindFirstMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('encodes only the linked tracing report pdf_url and keeps identity fields raw', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'received',
      updated_at: CURRENT_UPDATED_AT_DATE,
      recipient_name: '在宅主治医',
      related_entity_type: 'tracing_report',
      related_entity_id: HOSTILE_TRACING_REPORT_ID,
    });
    communicationRequestTxFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      related_entity_type: 'tracing_report',
      related_entity_id: HOSTILE_TRACING_REPORT_ID,
      recipient_name: '在宅主治医',
      status: 'responded',
      responses: [],
    });
    tracingReportFindFirstMock.mockResolvedValue({
      id: HOSTILE_TRACING_REPORT_ID,
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'received',
      sent_at: new Date('2026-03-28T05:00:00.000Z'),
      acknowledged_at: null,
    });

    const response = await PATCH(
      createRequest(
        {
          response: {
            responder_name: '在宅主治医',
            content: '現行処方で継続',
          },
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(tracingReportFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: HOSTILE_TRACING_REPORT_ID,
        org_id: 'org_1',
      },
      select: {
        id: true,
        patient_id: true,
        case_id: true,
        status: true,
        sent_at: true,
        acknowledged_at: true,
      },
    });
    expect(tracingReportUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: HOSTILE_TRACING_REPORT_ID,
        org_id: 'org_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        status: 'received',
        sent_at: new Date('2026-03-28T05:00:00.000Z'),
        acknowledged_at: null,
      },
      data: expect.objectContaining({
        status: 'acknowledged',
        sent_to_physician: '在宅主治医',
        pdf_url: HOSTILE_TRACING_REPORT_PDF_URL,
      }),
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'tracing_report_status_changed',
        target_id: HOSTILE_TRACING_REPORT_ID,
        changes: expect.objectContaining({
          linked_communication_request_id: 'request_1',
        }),
      }),
    });
  });

  it('rejects cross-case linked tracing reports before response, status, or audit side effects', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'received',
      updated_at: CURRENT_UPDATED_AT_DATE,
      related_entity_type: 'tracing_report',
      related_entity_id: 'tracing_2',
    });
    tracingReportFindFirstMock.mockResolvedValue({
      id: 'tracing_2',
      patient_id: 'patient_1',
      case_id: 'case_2',
      status: 'received',
      sent_at: new Date('2026-03-28T05:00:00.000Z'),
      acknowledged_at: null,
    });

    const response = await PATCH(
      createRequest(
        {
          response: {
            responder_name: '在宅主治医',
            content: '現行処方で継続',
          },
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '関連トレーシングレポートと患者またはケースが一致しません',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(tracingReportUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('lets an org-wide role respond through a linked tracing report in any in-org case', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: null,
      status: 'received',
      updated_at: CURRENT_UPDATED_AT_DATE,
      recipient_name: '在宅主治医',
      related_entity_type: 'tracing_report',
      related_entity_id: 'tracing_2',
    });
    tracingReportFindFirstMock.mockResolvedValue({
      id: 'tracing_2',
      patient_id: 'patient_1',
      case_id: 'case_2',
      status: 'received',
      sent_at: new Date('2026-03-28T05:00:00.000Z'),
      acknowledged_at: null,
    });
    careCaseFindFirstMock.mockImplementation(async (args: { where: { id?: string } }) =>
      args.where.id === 'case_2' ? null : { id: args.where.id ?? 'case_1' },
    );

    const response = await PATCH(
      createRequest(
        {
          response: {
            responder_name: '在宅主治医',
            content: '現行処方で継続',
          },
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(withOrgContextMock).toHaveBeenCalled();
    expect(communicationResponseCreateMock).toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).toHaveBeenCalled();
  });

  it('lets an org-wide role respond regardless of case assignment', async () => {
    careCaseFindFirstMock.mockResolvedValue(null);

    const response = await PATCH(
      createRequest(
        {
          response: {
            responder_name: '在宅主治医',
            content: '現行処方で継続',
          },
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(communicationResponseCreateMock).toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).toHaveBeenCalled();
  });
});
