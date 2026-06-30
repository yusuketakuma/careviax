import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const {
  requireAuthContextMock,
  tracingReportFindFirstMock,
  tracingReportUpdateManyMock,
  tracingReportFindUpdatedMock,
  tracingReportDeleteManyMock,
  careCaseFindFirstMock,
  communicationRequestFindManyMock,
  communicationRequestCreateMock,
  communicationRequestUpdateManyMock,
  communicationEventCreateMock,
  auditLogCreateMock,
  loggerErrorMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  tracingReportFindFirstMock: vi.fn(),
  tracingReportUpdateManyMock: vi.fn(),
  tracingReportFindUpdatedMock: vi.fn(),
  tracingReportDeleteManyMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  communicationRequestFindManyMock: vi.fn(),
  communicationRequestCreateMock: vi.fn(),
  communicationRequestUpdateManyMock: vi.fn(),
  communicationEventCreateMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    tracingReport: {
      findFirst: tracingReportFindFirstMock,
    },
    careCase: {
      findFirst: careCaseFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock },
}));

import { DELETE, PATCH } from './route';

const CURRENT_UPDATED_AT = '2026-03-28T04:30:00.000Z';
const STALE_UPDATED_AT = '2026-03-28T04:29:59.000Z';
const LINKED_REQUEST_UPDATED_AT = new Date('2026-03-28T05:30:00.000Z');

function withDefaultPatchVersion(body: unknown) {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    if (Object.prototype.hasOwnProperty.call(body, 'expected_updated_at')) return body;
    return { expected_updated_at: CURRENT_UPDATED_AT, ...body };
  }
  return body;
}

function createRequest(body: unknown, headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/tracing-reports/tracing_1', {
    method: body === null ? 'DELETE' : 'PATCH',
    headers: {
      ...headers,
      ...(body === null ? {} : { 'content-type': 'application/json' }),
    },
    body: body === null ? undefined : JSON.stringify(withDefaultPatchVersion(body)),
  });
}

function createMalformedPatchRequest(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/tracing-reports/tracing_1', {
    method: 'PATCH',
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    body: '{"status":',
  });
}

const HOSTILE_TRACING_REPORT_ID = 'tracing/with space%2F?x=#';
const HOSTILE_TRACING_REPORT_PDF_URL =
  '/api/tracing-reports/tracing%2Fwith%20space%252F%3Fx%3D%23/pdf';

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/tracing-reports/[id] PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    tracingReportFindFirstMock.mockResolvedValue({
      id: 'tracing_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'draft',
      sent_to_physician: null,
      sent_at: null,
      acknowledged_at: null,
      updated_at: new Date(CURRENT_UPDATED_AT),
    });
    tracingReportUpdateManyMock.mockResolvedValue({ count: 1 });
    tracingReportFindUpdatedMock.mockResolvedValue({
      id: 'tracing_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      issue_id: 'issue_1',
      content: {},
      status: 'sent',
      sent_to_physician: '在宅主治医',
      sent_at: new Date('2026-03-28T05:00:00.000Z'),
      acknowledged_at: null,
      pdf_url: '/api/tracing-reports/tracing_1/pdf',
      created_at: new Date('2026-03-28T04:00:00.000Z'),
      updated_at: new Date('2026-03-28T05:00:00.000Z'),
    });
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_1' });
    communicationRequestFindManyMock.mockResolvedValue([]);
    communicationRequestCreateMock.mockResolvedValue({ id: 'request_1' });
    communicationRequestUpdateManyMock.mockResolvedValue({ count: 1 });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        tracingReport: {
          updateMany: tracingReportUpdateManyMock,
          findFirst: tracingReportFindUpdatedMock,
        },
        communicationRequest: {
          findMany: communicationRequestFindManyMock,
          create: communicationRequestCreateMock,
          updateMany: communicationRequestUpdateManyMock,
        },
        communicationEvent: {
          create: communicationEventCreateMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('rejects blank tracing report ids before parsing or loading the report', async () => {
    const response = await PATCH(
      createRequest(
        {
          status: 'sent',
          sent_to_physician: '在宅主治医',
          status_change_reason: '医師へ服薬情報提供書を送付',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: '   ' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'トレーシングレポートIDが不正です',
    });
    expect(tracingReportFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(tracingReportUpdateManyMock).not.toHaveBeenCalled();
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('marks a draft tracing report as sent and creates a linked communication request', async () => {
    const response = await PATCH(
      createRequest(
        {
          status: ' sent ',
          sent_to_physician: ' 在宅主治医 ',
          status_change_reason: ' 医師へ服薬情報提供書を送付 ',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'tracing_1' }) },
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
        status: 'draft',
        sent_at: null,
        acknowledged_at: null,
        updated_at: new Date(CURRENT_UPDATED_AT),
      },
      data: expect.objectContaining({
        status: 'sent',
        sent_to_physician: '在宅主治医',
        pdf_url: '/api/tracing-reports/tracing_1/pdf',
      }),
    });
    expect(tracingReportFindUpdatedMock).toHaveBeenCalledWith({
      where: { id: 'tracing_1', org_id: 'org_1' },
      select: expect.any(Object),
    });
    expect(communicationRequestCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        request_type: 'tracing_report',
        related_entity_type: 'tracing_report',
        related_entity_id: 'tracing_1',
        status: 'sent',
        recipient_name: '在宅主治医',
      }),
    });
    expect(communicationEventCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event_type: 'tracing_report',
          counterpart_name: '在宅主治医',
          // チャネル未指定時は自動送信可能な既定 ph_os_share になる（旧来の幻の 'fax' 既定は廃止）。
          channel: 'ph_os_share',
        }),
      }),
    );
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'communication_request_status_changed',
        target_type: 'communication_request',
        target_id: 'request_1',
        changes: expect.objectContaining({
          from_status: null,
          to_status: 'sent',
          reason: '医師へ服薬情報提供書を送付',
          linked_tracing_report_id: 'tracing_1',
          actor_id: 'user_1',
        }),
      }),
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'tracing_report_status_changed',
        target_type: 'tracing_report',
        target_id: 'tracing_1',
        changes: expect.objectContaining({
          from_status: 'draft',
          to_status: 'sent',
          reason: '医師へ服薬情報提供書を送付',
          sent_to_physician: '在宅主治医',
          linked_request_id: 'request_1',
          actor_id: 'user_1',
        }),
      }),
    });
  });

  it('encodes only the pdf_url path segment and keeps tracing report identity raw', async () => {
    tracingReportFindUpdatedMock.mockResolvedValue({
      id: HOSTILE_TRACING_REPORT_ID,
      patient_id: 'patient_1',
      case_id: 'case_1',
      issue_id: 'issue_1',
      content: {},
      status: 'sent',
      sent_to_physician: '在宅主治医',
      sent_at: new Date('2026-03-28T05:00:00.000Z'),
      acknowledged_at: null,
      pdf_url: HOSTILE_TRACING_REPORT_PDF_URL,
      created_at: new Date('2026-03-28T04:00:00.000Z'),
      updated_at: new Date('2026-03-28T05:00:00.000Z'),
    });

    const response = await PATCH(
      createRequest(
        {
          status: 'sent',
          sent_to_physician: '在宅主治医',
          status_change_reason: '医師へ服薬情報提供書を送付',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: HOSTILE_TRACING_REPORT_ID }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(tracingReportFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: HOSTILE_TRACING_REPORT_ID, org_id: 'org_1' },
      }),
    );
    expect(tracingReportUpdateManyMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: HOSTILE_TRACING_REPORT_ID,
        org_id: 'org_1',
        updated_at: new Date(CURRENT_UPDATED_AT),
      }),
      data: expect.objectContaining({
        status: 'sent',
        pdf_url: HOSTILE_TRACING_REPORT_PDF_URL,
      }),
    });
    expect(communicationRequestFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          related_entity_id: HOSTILE_TRACING_REPORT_ID,
        }),
      }),
    );
    expect(communicationRequestCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        related_entity_type: 'tracing_report',
        related_entity_id: HOSTILE_TRACING_REPORT_ID,
      }),
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'tracing_report_status_changed',
        target_id: HOSTILE_TRACING_REPORT_ID,
      }),
    });
  });

  it('records the explicitly selected deliverable channel on the communication event', async () => {
    const response = await PATCH(
      createRequest(
        {
          status: 'sent',
          sent_to_physician: '在宅主治医',
          channel: 'email',
          status_change_reason: '医師へ服薬情報提供書を送付',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'tracing_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(communicationEventCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event_type: 'tracing_report',
          channel: 'email',
        }),
      }),
    );
  });

  it('records a manually sent fax without any automated transmission', async () => {
    const response = await PATCH(
      createRequest(
        {
          status: 'sent',
          sent_to_physician: '在宅主治医',
          // 手動 FAX 送付の記録（自動送信は行わない）。
          channel: 'fax',
          status_change_reason: '医師へ FAX で服薬情報提供書を手動送付',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'tracing_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(communicationEventCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event_type: 'tracing_report',
          // 手動送付の事実として記録されるだけで、ゲートウェイ送信は発生しない。
          channel: 'fax',
        }),
      }),
    );
  });

  it('returns 400 for an invalid communication event channel before side effects', async () => {
    const response = await PATCH(
      createRequest(
        {
          status: 'sent',
          sent_to_physician: '在宅主治医',
          channel: 'other',
          status_change_reason: '医師へ服薬情報提供書を送付',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'tracing_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'channel が不正です',
    });
    expect(tracingReportFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(tracingReportUpdateManyMock).not.toHaveBeenCalled();
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects blank status before loading the tracing report', async () => {
    const response = await PATCH(
      createRequest(
        {
          status: '   ',
          sent_to_physician: '在宅主治医',
          status_change_reason: '医師へ服薬情報提供書を送付',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'tracing_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'status が不正です',
    });
    expect(tracingReportFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(tracingReportUpdateManyMock).not.toHaveBeenCalled();
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects non-object request bodies before loading the tracing report', async () => {
    const response = await PATCH(createRequest(['unexpected'], { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'tracing_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(tracingReportFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(tracingReportUpdateManyMock).not.toHaveBeenCalled();
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before loading the tracing report', async () => {
    const response = await PATCH(createMalformedPatchRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'tracing_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(tracingReportFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(tracingReportUpdateManyMock).not.toHaveBeenCalled();
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('requires a reason when changing tracing report status', async () => {
    const response = await PATCH(
      createRequest({ status: 'sent', sent_to_physician: '在宅主治医' }, { 'x-org-id': 'org_1' }),
      { params: Promise.resolve({ id: 'tracing_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'ステータス変更理由は必須です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('requires expected_updated_at before loading the tracing report for mutation work', async () => {
    const response = await PATCH(
      createRequest(
        {
          expected_updated_at: undefined,
          status: 'sent',
          sent_to_physician: '在宅主治医',
          status_change_reason: '医師へ服薬情報提供書を送付',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'tracing_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { expected_updated_at: expect.any(Array) },
    });
    expect(tracingReportFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(tracingReportUpdateManyMock).not.toHaveBeenCalled();
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns conflict for stale expected_updated_at before transaction side effects', async () => {
    const response = await PATCH(
      createRequest(
        {
          expected_updated_at: STALE_UPDATED_AT,
          status: 'sent',
          sent_to_physician: '在宅主治医',
          status_change_reason: '医師へ服薬情報提供書を送付',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'tracing_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: {
        expected_updated_at: STALE_UPDATED_AT,
        current_updated_at: CURRENT_UPDATED_AT,
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(tracingReportUpdateManyMock).not.toHaveBeenCalled();
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('does not update or create side effects when assignment access is denied', async () => {
    careCaseFindFirstMock.mockResolvedValue(null);

    const response = await PATCH(
      createRequest(
        {
          status: 'sent',
          sent_to_physician: '在宅主治医',
          status_change_reason: '医師へ服薬情報提供書を送付',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'tracing_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(tracingReportUpdateManyMock).not.toHaveBeenCalled();
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rolls back when the tracing report claim loses the race inside the transaction', async () => {
    tracingReportUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await PATCH(
      createRequest(
        {
          status: 'sent',
          sent_to_physician: '在宅主治医',
          status_change_reason: '医師へ服薬情報提供書を送付',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'tracing_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
    });
    expect(tracingReportUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'tracing_1',
          org_id: 'org_1',
          status: 'draft',
          updated_at: new Date(CURRENT_UPDATED_AT),
        }),
      }),
    );
    expect(tracingReportFindUpdatedMock).not.toHaveBeenCalled();
    expect(communicationRequestFindManyMock).not.toHaveBeenCalled();
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('closes the linked communication request when a tracing report is acknowledged', async () => {
    tracingReportFindFirstMock.mockResolvedValue({
      id: 'tracing_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'received',
      sent_to_physician: '在宅主治医',
      sent_at: new Date('2026-03-28T05:00:00.000Z'),
      acknowledged_at: null,
      updated_at: new Date(CURRENT_UPDATED_AT),
    });
    tracingReportFindUpdatedMock.mockResolvedValue({
      id: 'tracing_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      issue_id: 'issue_1',
      content: {},
      status: 'acknowledged',
      sent_to_physician: '在宅主治医',
      sent_at: new Date('2026-03-28T05:00:00.000Z'),
      acknowledged_at: new Date('2026-03-28T06:00:00.000Z'),
      pdf_url: '/api/tracing-reports/tracing_1/pdf',
      created_at: new Date('2026-03-28T04:00:00.000Z'),
      updated_at: new Date('2026-03-28T06:00:00.000Z'),
    });
    communicationRequestFindManyMock.mockResolvedValue([
      {
        id: 'request_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        related_entity_type: 'tracing_report',
        related_entity_id: 'tracing_1',
        status: 'received',
        updated_at: LINKED_REQUEST_UPDATED_AT,
      },
    ]);

    const response = await PATCH(
      createRequest(
        { status: 'acknowledged', status_change_reason: '医師から受領確認済み' },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'tracing_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(communicationRequestUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'request_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        related_entity_type: 'tracing_report',
        related_entity_id: 'tracing_1',
        status: 'received',
        updated_at: LINKED_REQUEST_UPDATED_AT,
      },
      data: {
        status: 'closed',
        recipient_name: '在宅主治医',
      },
    });
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'communication_request_status_changed',
        target_type: 'communication_request',
        target_id: 'request_1',
        changes: expect.objectContaining({
          from_status: 'received',
          to_status: 'closed',
          reason: '医師から受領確認済み',
          linked_tracing_report_id: 'tracing_1',
          actor_id: 'user_1',
        }),
      }),
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'tracing_report_status_changed',
        changes: expect.objectContaining({
          from_status: 'received',
          to_status: 'acknowledged',
          reason: '医師から受領確認済み',
          linked_request_id: 'request_1',
          actor_id: 'user_1',
        }),
      }),
    });
  });

  it('rolls back when a linked communication request claim loses the race', async () => {
    communicationRequestFindManyMock.mockResolvedValue([
      {
        id: 'request_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        related_entity_type: 'tracing_report',
        related_entity_id: 'tracing_1',
        status: 'draft',
        updated_at: LINKED_REQUEST_UPDATED_AT,
      },
    ]);
    communicationRequestUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await PATCH(
      createRequest(
        {
          status: 'sent',
          sent_to_physician: '在宅主治医',
          status_change_reason: '医師へ服薬情報提供書を送付',
        },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'tracing_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
    });
    expect(tracingReportUpdateManyMock).toHaveBeenCalled();
    expect(tracingReportFindUpdatedMock).toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'request_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        related_entity_type: 'tracing_report',
        related_entity_id: 'tracing_1',
        status: 'draft',
        updated_at: LINKED_REQUEST_UPDATED_AT,
      },
      data: {
        status: 'sent',
        recipient_name: '在宅主治医',
      },
    });
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });
});

describe('/api/tracing-reports/[id] DELETE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    tracingReportFindFirstMock.mockResolvedValue({
      id: 'tracing_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'draft',
    });
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        tracingReport: {
          deleteMany: tracingReportDeleteManyMock,
        },
      }),
    );
    tracingReportDeleteManyMock.mockResolvedValue({ count: 1 });
  });

  it('rejects blank tracing report ids before loading or deleting the report', async () => {
    const response = await DELETE(createRequest(null, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'トレーシングレポートIDが不正です',
    });
    expect(tracingReportFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('deletes only when the reviewed tracing report is still a draft', async () => {
    const response = await DELETE(createRequest(null, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'tracing_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: { id: 'tracing_1' },
    });
    expect(tracingReportDeleteManyMock).toHaveBeenCalledWith({
      where: {
        id: 'tracing_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        status: 'draft',
      },
    });
  });

  it('returns conflict when the draft delete claim loses the race', async () => {
    tracingReportDeleteManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await DELETE(createRequest(null, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'tracing_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
    });
    expect(tracingReportDeleteManyMock).toHaveBeenCalledWith({
      where: {
        id: 'tracing_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        status: 'draft',
      },
    });
  });

  it('does not delete when assignment access is denied', async () => {
    careCaseFindFirstMock.mockResolvedValue(null);

    const response = await DELETE(createRequest(null, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'tracing_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns sensitive no-store auth failures before delete lookups', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: NextResponse.json({ code: 'AUTH_FORBIDDEN' }, { status: 403 }),
    });

    const response = await DELETE(createRequest(null, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'tracing_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({ code: 'AUTH_FORBIDDEN' });
    expect(tracingReportFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(tracingReportDeleteManyMock).not.toHaveBeenCalled();
  });
});
