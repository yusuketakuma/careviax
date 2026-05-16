import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  communicationRequestFindFirstMock,
  communicationRequestUpdateMock,
  communicationResponseCreateMock,
  tracingReportFindFirstMock,
  tracingReportUpdateMock,
  auditLogCreateMock,
  careCaseFindFirstMock,
  patientFindFirstMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  communicationRequestFindFirstMock: vi.fn(),
  communicationRequestUpdateMock: vi.fn(),
  communicationResponseCreateMock: vi.fn(),
  tracingReportFindFirstMock: vi.fn(),
  tracingReportUpdateMock: vi.fn(),
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

import { PATCH } from './route';

function createRequest(body: unknown, headers?: Record<string, string>) {
  return {
    headers: {
      get: (key: string) => headers?.[key] ?? null,
    },
    json: async () => body,
  } as unknown as NextRequest;
}

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
    communicationRequestUpdateMock.mockResolvedValue({
      id: 'request_1',
      status: 'responded',
      responses: [],
    });
    communicationResponseCreateMock.mockResolvedValue({ id: 'response_1' });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        communicationRequest: {
          update: communicationRequestUpdateMock,
        },
        communicationResponse: {
          create: communicationResponseCreateMock,
        },
        tracingReport: {
          update: tracingReportUpdateMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('rejects invalid status transitions', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      status: 'draft',
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
    expect(communicationRequestUpdateMock).not.toHaveBeenCalled();
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
    expect(communicationRequestUpdateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('records an audit log with the reason for direct status changes', async () => {
    const response = await PATCH(
      createRequest(
        { status: 'in_progress', status_change_reason: '電話で受領確認し対応を開始' },
        { 'x-org-id': 'org_1' },
      ),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(communicationRequestUpdateMock).toHaveBeenCalledWith({
      where: { id: 'request_1' },
      data: { status: 'in_progress' },
      select: expect.any(Object),
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

  it('records a response and auto-advances to responded', async () => {
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
    expect(communicationResponseCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        request_id: 'request_1',
        responder_name: '在宅主治医',
        content: '現行処方で継続',
      }),
    });
    expect(communicationRequestUpdateMock).toHaveBeenCalledWith({
      where: { id: 'request_1' },
      data: { status: 'responded' },
      select: expect.any(Object),
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

  it('updates and audits a linked tracing report only after scope consistency is verified', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'received',
      related_entity_type: 'tracing_report',
      related_entity_id: 'tracing_1',
    });
    communicationRequestUpdateMock.mockResolvedValue({
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
    expect(tracingReportUpdateMock).toHaveBeenCalledWith({
      where: { id: 'tracing_1' },
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

  it('rejects cross-case linked tracing reports before response, status, or audit side effects', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'received',
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
    expect(communicationRequestUpdateMock).not.toHaveBeenCalled();
    expect(tracingReportUpdateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns not found for an inaccessible linked tracing report before side effects', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: null,
      status: 'received',
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
    expect(response.status).toBe(404);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateMock).not.toHaveBeenCalled();
    expect(tracingReportUpdateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns not found and skips side effects for an unassigned request', async () => {
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
    expect(response.status).toBe(404);
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });
});
