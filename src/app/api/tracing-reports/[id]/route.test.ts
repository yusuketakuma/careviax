import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  tracingReportFindFirstMock,
  tracingReportUpdateMock,
  careCaseFindFirstMock,
  communicationRequestFindManyMock,
  communicationRequestCreateMock,
  communicationRequestUpdateMock,
  communicationEventCreateMock,
  auditLogCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  tracingReportFindFirstMock: vi.fn(),
  tracingReportUpdateMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  communicationRequestFindManyMock: vi.fn(),
  communicationRequestCreateMock: vi.fn(),
  communicationRequestUpdateMock: vi.fn(),
  communicationEventCreateMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
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

import { DELETE, PATCH } from './route';

function createRequest(body: unknown, headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/tracing-reports/tracing_1', {
    method: body === null ? 'DELETE' : 'PATCH',
    headers: {
      ...headers,
      ...(body === null ? {} : { 'content-type': 'application/json' }),
    },
    body: body === null ? undefined : JSON.stringify(body),
  });
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
    });
    tracingReportUpdateMock.mockResolvedValue({
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
    communicationRequestUpdateMock.mockResolvedValue({ id: 'request_1' });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        tracingReport: {
          update: tracingReportUpdateMock,
        },
        communicationRequest: {
          findMany: communicationRequestFindManyMock,
          create: communicationRequestCreateMock,
          update: communicationRequestUpdateMock,
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

  it('marks a draft tracing report as sent and creates a linked communication request', async () => {
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
    expect(response.status).toBe(200);
    expect(tracingReportUpdateMock).toHaveBeenCalledWith({
      where: { id: 'tracing_1' },
      data: expect.objectContaining({
        status: 'sent',
        sent_to_physician: '在宅主治医',
        pdf_url: '/api/tracing-reports/tracing_1/pdf',
      }),
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
          channel: 'fax',
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
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'channel が不正です',
    });
    expect(tracingReportFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(tracingReportUpdateMock).not.toHaveBeenCalled();
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateMock).not.toHaveBeenCalled();
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
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(tracingReportUpdateMock).not.toHaveBeenCalled();
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateMock).not.toHaveBeenCalled();
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
    });
    tracingReportUpdateMock.mockResolvedValue({
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
    communicationRequestFindManyMock.mockResolvedValue([{ id: 'request_1', status: 'received' }]);

    const response = await PATCH(
      createRequest(
        { status: 'acknowledged', status_change_reason: '医師から受領確認済み' },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'tracing_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(communicationRequestUpdateMock).toHaveBeenCalledWith({
      where: { id: 'request_1' },
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
          delete: vi.fn().mockResolvedValue({ id: 'tracing_1' }),
        },
      }),
    );
  });

  it('does not delete when assignment access is denied', async () => {
    careCaseFindFirstMock.mockResolvedValue(null);

    const response = await DELETE(createRequest(null, { 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'tracing_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });
});
