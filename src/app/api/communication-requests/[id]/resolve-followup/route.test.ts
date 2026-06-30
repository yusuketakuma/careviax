import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  communicationRequestFindFirstMock,
  communicationRequestUpdateManyMock,
  communicationRequestTxFindFirstMock,
  communicationResponseFindFirstMock,
  communicationResponseCreateMock,
  tracingReportFindFirstMock,
  tracingReportUpdateManyMock,
  taskUpsertMock,
  auditLogCreateMock,
  careCaseFindFirstMock,
  patientFindFirstMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  communicationRequestFindFirstMock: vi.fn(),
  communicationRequestUpdateManyMock: vi.fn(),
  communicationRequestTxFindFirstMock: vi.fn(),
  communicationResponseFindFirstMock: vi.fn(),
  communicationResponseCreateMock: vi.fn(),
  tracingReportFindFirstMock: vi.fn(),
  tracingReportUpdateManyMock: vi.fn(),
  taskUpsertMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
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
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { POST } from './route';

const CURRENT_UPDATED_AT = '2026-06-18T00:00:00.000Z';
const CURRENT_UPDATED_AT_DATE = new Date(CURRENT_UPDATED_AT);
const HOSTILE_TRACING_REPORT_ID = 'tracing/with space%2F?x=#';
const HOSTILE_TRACING_REPORT_PDF_URL =
  '/api/tracing-reports/tracing%2Fwith%20space%252F%3Fx%3D%23/pdf';

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/communication-requests/request_1/resolve-followup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/communication-requests/[id]/resolve-followup POST', () => {
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
      status: 'sent',
      updated_at: CURRENT_UPDATED_AT_DATE,
      subject: '服薬情報提供書の確認',
      recipient_name: '在宅主治医',
      related_entity_type: null,
      related_entity_id: null,
    });
    communicationRequestUpdateManyMock.mockResolvedValue({ count: 1 });
    communicationRequestTxFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      related_entity_type: null,
      related_entity_id: null,
      recipient_name: '在宅主治医',
      status: 'closed',
      updated_at: new Date('2026-06-18T00:01:00.000Z'),
      responses: [],
    });
    communicationResponseFindFirstMock.mockResolvedValue(null);
    communicationResponseCreateMock.mockResolvedValue({ id: 'response_1' });
    taskUpsertMock.mockResolvedValue({ id: 'task_1' });
    tracingReportFindFirstMock.mockResolvedValue(null);
    tracingReportUpdateManyMock.mockResolvedValue({ count: 1 });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_1' });
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1', archived_at: null });
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
        task: {
          upsert: taskUpsertMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('records the response, follow-up task, request close, and audit in one transaction', async () => {
    const response = await POST(
      createRequest({
        expected_updated_at: CURRENT_UPDATED_AT,
        response: {
          responder_name: '在宅主治医',
          content: '現行処方で継続',
          responded_at: '2026-06-18T00:02:00.000Z',
        },
        followup: '夕食後薬の飲み忘れを確認',
      }),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(communicationRequestUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'request_1',
        org_id: 'org_1',
        status: 'sent',
        updated_at: CURRENT_UPDATED_AT_DATE,
      },
      data: { status: 'closed' },
    });
    expect(communicationResponseCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        request_id: 'request_1',
        responder_name: '在宅主治医',
        content: '現行処方で継続',
        responded_at: new Date('2026-06-18T00:02:00.000Z'),
        response_intent_key: expect.stringMatching(/^communication-response:v2:[a-f0-9]{64}$/),
      }),
    });
    expect(taskUpsertMock).toHaveBeenCalledWith({
      where: {
        org_id_dedupe_key: {
          org_id: 'org_1',
          dedupe_key: 'communication-request-followup:request_1',
        },
      },
      create: expect.objectContaining({
        org_id: 'org_1',
        task_type: 'communication_request_followup',
        title: '返信フォロー: 服薬情報提供書の確認',
        description: '夕食後薬の飲み忘れを確認',
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
      }),
      update: expect.objectContaining({
        task_type: 'communication_request_followup',
        description: '夕食後薬の飲み忘れを確認',
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
      }),
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'communication_request_status_changed',
        target_type: 'communication_request',
        target_id: 'request_1',
        changes: expect.objectContaining({
          from_status: 'sent',
          to_status: 'closed',
          reason: 'フォロー対応済み（次回カードへ残す）',
          status_change_reason: 'フォロー対応済み（次回カードへ残す）',
          response_id: 'response_1',
          followup_task_id: 'task_1',
          followup_content_digest: expect.stringMatching(
            /^communication-request-followup:v1:[a-f0-9]{64}$/,
          ),
          followup_content_length: 12,
        }),
      }),
    });
    expect(JSON.stringify(auditLogCreateMock.mock.calls[0]?.[0]?.data.changes)).not.toContain(
      '夕食後薬の飲み忘れを確認',
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        request: { id: 'request_1', status: 'closed' },
        response: { id: 'response_1' },
        task: { id: 'task_1' },
      },
    });
  });

  it('rejects stale expected_updated_at before transaction side effects', async () => {
    const response = await POST(
      createRequest({
        expected_updated_at: '2026-06-17T23:59:59.000Z',
        response: {
          responder_name: '在宅主治医',
          content: '現行処方で継続',
        },
      }),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(taskUpsertMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('requires visit task permission when creating a follow-up task', async () => {
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'clerk_1',
        role: 'clerk',
      },
    });

    const response = await POST(
      createRequest({
        expected_updated_at: CURRENT_UPDATED_AT,
        followup: '夕食後薬の飲み忘れを確認',
      }),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(taskUpsertMock).not.toHaveBeenCalled();
  });

  it('rejects care report follow-up resolution when the caller cannot send reports', async () => {
    requireAuthContextMock.mockResolvedValue({
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
      subject: '報告書共有の確認',
      recipient_name: '在宅主治医',
      related_entity_type: 'care_report',
      related_entity_id: 'report_1',
    });

    const response = await POST(
      createRequest({
        expected_updated_at: CURRENT_UPDATED_AT,
      }),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(taskUpsertMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('keeps care report follow-up tasks in the report response queue', async () => {
    communicationRequestFindFirstMock.mockResolvedValueOnce({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'sent',
      updated_at: CURRENT_UPDATED_AT_DATE,
      subject: '報告書共有の確認',
      recipient_name: '在宅主治医',
      related_entity_type: 'care_report',
      related_entity_id: 'report_1',
    });

    const response = await POST(
      createRequest({
        expected_updated_at: CURRENT_UPDATED_AT,
        followup: '報告書返信を確認',
      }),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(taskUpsertMock).toHaveBeenCalledWith({
      where: {
        org_id_dedupe_key: {
          org_id: 'org_1',
          dedupe_key: 'communication-request-followup:request_1',
        },
      },
      create: expect.objectContaining({
        task_type: 'report_response_followup',
        description: '報告書返信を確認',
        related_entity_type: 'care_report',
        related_entity_id: 'report_1',
      }),
      update: expect.objectContaining({
        task_type: 'report_response_followup',
        description: '報告書返信を確認',
        related_entity_type: 'care_report',
        related_entity_id: 'report_1',
      }),
    });
  });

  it('syncs a linked tracing report only after scope consistency is verified', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'responded',
      updated_at: CURRENT_UPDATED_AT_DATE,
      subject: '服薬情報提供書の確認',
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
      status: 'closed',
      updated_at: new Date('2026-06-18T00:01:00.000Z'),
      responses: [],
    });
    tracingReportFindFirstMock.mockResolvedValue({
      id: 'tracing_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'received',
      sent_at: new Date('2026-06-17T00:00:00.000Z'),
      acknowledged_at: null,
    });

    const response = await POST(
      createRequest({
        expected_updated_at: CURRENT_UPDATED_AT,
        followup: 'トレーシング返信を確認',
      }),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(tracingReportUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'tracing_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        status: 'received',
        sent_at: new Date('2026-06-17T00:00:00.000Z'),
        acknowledged_at: null,
      },
      data: expect.objectContaining({
        status: 'acknowledged',
        sent_to_physician: '在宅主治医',
        pdf_url: '/api/tracing-reports/tracing_1/pdf',
        acknowledged_at: expect.any(Date),
      }),
    });
    expect(taskUpsertMock).toHaveBeenCalledWith({
      where: {
        org_id_dedupe_key: {
          org_id: 'org_1',
          dedupe_key: 'communication-request-followup:request_1',
        },
      },
      create: expect.objectContaining({
        task_type: 'tracing_report_followup',
        description: 'トレーシング返信を確認',
        related_entity_type: 'tracing_report',
        related_entity_id: 'tracing_1',
      }),
      update: expect.objectContaining({
        task_type: 'tracing_report_followup',
        description: 'トレーシング返信を確認',
        related_entity_type: 'tracing_report',
        related_entity_id: 'tracing_1',
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
          reason: 'フォロー対応済み（次回カードへ残す）',
          followup_content_digest: expect.stringMatching(
            /^communication-request-followup:v1:[a-f0-9]{64}$/,
          ),
          followup_content_length: 11,
          linked_communication_request_id: 'request_1',
        }),
      }),
    });
    for (const call of auditLogCreateMock.mock.calls) {
      expect(JSON.stringify(call[0]?.data.changes)).not.toContain('トレーシング返信を確認');
    }
  });

  it('returns conflict before response, task, or audit side effects when the linked tracing report changes concurrently', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'responded',
      updated_at: CURRENT_UPDATED_AT_DATE,
      subject: '服薬情報提供書の確認',
      recipient_name: '在宅主治医',
      related_entity_type: 'tracing_report',
      related_entity_id: 'tracing_1',
    });
    tracingReportFindFirstMock.mockResolvedValue({
      id: 'tracing_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'received',
      sent_at: new Date('2026-06-17T00:00:00.000Z'),
      acknowledged_at: null,
    });
    tracingReportUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await POST(
      createRequest({
        expected_updated_at: CURRENT_UPDATED_AT,
        response: {
          responder_name: '在宅主治医',
          content: '現行処方で継続',
          responded_at: '2026-06-18T00:02:00.000Z',
        },
        followup: 'トレーシング返信を確認',
      }),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '連携依頼が同時に更新されました。再読み込みしてください',
    });
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(taskUpsertMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('encodes only the linked tracing report pdf_url and keeps follow-up identity fields raw', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'responded',
      updated_at: CURRENT_UPDATED_AT_DATE,
      subject: '服薬情報提供書の確認',
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
      status: 'closed',
      updated_at: new Date('2026-06-18T00:01:00.000Z'),
      responses: [],
    });
    tracingReportFindFirstMock.mockResolvedValue({
      id: HOSTILE_TRACING_REPORT_ID,
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'received',
      sent_at: new Date('2026-06-17T00:00:00.000Z'),
      acknowledged_at: null,
    });

    const response = await POST(
      createRequest({
        expected_updated_at: CURRENT_UPDATED_AT,
        followup: 'トレーシング返信を確認',
      }),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
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
        sent_at: new Date('2026-06-17T00:00:00.000Z'),
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

  it('returns a sanitized no-store 500 when auth context fails before request loading', async () => {
    requireAuthContextMock.mockRejectedValueOnce(
      new Error('raw communication followup auth patient 山田 花子 token secret'),
    );

    const response = await POST(
      createRequest({
        expected_updated_at: CURRENT_UPDATED_AT,
      }),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('raw communication followup auth');
    expect(bodyText).not.toContain('山田 花子');
    expect(bodyText).not.toContain('token secret');
    expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when follow-up transaction fails unexpectedly', async () => {
    withOrgContextMock.mockRejectedValueOnce(
      new Error('raw followup transaction patient 山田 花子 token secret 夕食後薬'),
    );

    const response = await POST(
      createRequest({
        expected_updated_at: CURRENT_UPDATED_AT,
        followup: '夕食後薬の飲み忘れを確認',
      }),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('raw followup transaction');
    expect(bodyText).not.toContain('山田 花子');
    expect(bodyText).not.toContain('token secret');
    expect(bodyText).not.toContain('夕食後薬');
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(taskUpsertMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });
});
