import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import {
  createResolveFollowupRequest as createRequest,
  CURRENT_UPDATED_AT,
  CURRENT_UPDATED_AT_DATE,
  HOSTILE_TRACING_REPORT_ID,
  HOSTILE_TRACING_REPORT_PDF_URL,
} from './route.test-fixtures';

const {
  authContext,
  requireAuthContextMock,
  runWithRequestAuthContextMock,
  withRoutePerformanceMock,
  loggerErrorMock,
  unstableRethrowMock,
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
  authContext: {
    orgId: 'org_1',
    userId: 'user_1',
    role: 'pharmacist',
    requestId: 'request_1',
    correlationId: 'correlation_1',
  },
  requireAuthContextMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn((_ctx, callback: () => unknown) => callback()),
  withRoutePerformanceMock: vi.fn((_req, callback: () => unknown) => callback()),
  loggerErrorMock: vi.fn(),
  unstableRethrowMock: vi.fn(),
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

vi.mock('next/navigation', () => ({ unstable_rethrow: unstableRethrowMock }));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
  withAuthContext:
    (
      handler: (
        req: NextRequest,
        ctx: typeof authContext,
        routeContext: { params: Promise<{ id: string }> },
      ) => Promise<Response>,
      options: unknown,
    ) =>
    async (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      withRoutePerformanceMock(req, async () => {
        let authResult: { ctx: typeof authContext } | { response: Response };
        try {
          authResult = await requireAuthContextMock(req, options);
        } catch (error) {
          unstableRethrowMock(error);
          const trace = {
            requestId: 'generated_request_1',
            correlationId: req.headers.get('x-correlation-id') ?? 'generated_request_1',
          };
          loggerErrorMock(
            {
              event: 'route_auth_unhandled_error',
              route: req.nextUrl.pathname,
              method: req.method,
              requestId: trace.requestId,
              correlationId: trace.correlationId,
            },
            error,
          );
          const response = NextResponse.json(
            { code: 'INTERNAL_ERROR', message: 'サーバー内部でエラーが発生しました' },
            { status: 500 },
          );
          response.headers.set('Cache-Control', 'private, no-store, max-age=0');
          response.headers.set('Pragma', 'no-cache');
          response.headers.set('X-Request-Id', trace.requestId);
          response.headers.set('X-Correlation-Id', trace.correlationId);
          return response;
        }

        if ('response' in authResult) {
          authResult.response.headers.set('Cache-Control', 'private, no-store, max-age=0');
          authResult.response.headers.set('Pragma', 'no-cache');
          return authResult.response;
        }

        return runWithRequestAuthContextMock(authResult.ctx, async () => {
          try {
            const response = await handler(req, authResult.ctx, routeContext);
            response.headers.set('Cache-Control', 'private, no-store, max-age=0');
            response.headers.set('Pragma', 'no-cache');
            response.headers.set('X-Request-Id', authResult.ctx.requestId);
            response.headers.set('X-Correlation-Id', authResult.ctx.correlationId);
            return response;
          } catch (error) {
            unstableRethrowMock(error);
            loggerErrorMock(
              {
                event: 'route_handler_unhandled_error',
                route: req.nextUrl.pathname,
                method: req.method,
                requestId: authResult.ctx.requestId,
                correlationId: authResult.ctx.correlationId,
              },
              error,
            );
            const response = NextResponse.json(
              { code: 'INTERNAL_ERROR', message: 'サーバー内部でエラーが発生しました' },
              { status: 500 },
            );
            response.headers.set('Cache-Control', 'private, no-store, max-age=0');
            response.headers.set('Pragma', 'no-cache');
            response.headers.set('X-Request-Id', authResult.ctx.requestId);
            response.headers.set('X-Correlation-Id', authResult.ctx.correlationId);
            return response;
          }
        });
      }),
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

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

async function expectNeutralLinkedTracingReportValidationError(response: Response) {
  expect(response.status).toBe(400);
  expectSensitiveNoStore(response);
  await expect(response.json()).resolves.toEqual({
    code: 'VALIDATION_ERROR',
    message: '入力値が不正です',
    details: {
      related_entity_id: ['指定された関連先を確認できません'],
    },
  });
}

describe('/api/communication-requests/[id]/resolve-followup POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({ ctx: authContext });
    runWithRequestAuthContextMock.mockImplementation((_ctx, callback) => callback());
    withRoutePerformanceMock.mockImplementation((_req, callback) => callback());
    unstableRethrowMock.mockImplementation(() => undefined);
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
    taskUpsertMock.mockResolvedValue({ id: 'task_1', display_id: 'task0000000001' });
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
    expect(response.headers.get('X-Request-Id')).toBe('request_1');
    expect(response.headers.get('X-Correlation-Id')).toBe('correlation_1');
    expect(withRoutePerformanceMock).toHaveBeenCalledOnce();
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canReport',
      message: '連携依頼の更新権限がありません',
    });
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(authContext, expect.any(Function));
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: authContext,
    });
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
      select: {
        id: true,
        display_id: true,
      },
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

  it('lets a clerk create a general operational follow-up task', async () => {
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
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(communicationRequestFindFirstMock).toHaveBeenCalled();
    expect(withOrgContextMock).toHaveBeenCalled();
    expect(taskUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          task_type: 'communication_request_followup',
          description: '夕食後薬の飲み忘れを確認',
        }),
      }),
    );
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
      select: {
        id: true,
        display_id: true,
      },
    });
  });

  it('returns the generic linked validation error when a tracing report is missing or outside the organization', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'responded',
      updated_at: CURRENT_UPDATED_AT_DATE,
      subject: '服薬情報提供書の確認',
      recipient_name: '在宅主治医',
      related_entity_type: 'tracing_report',
      related_entity_id: 'tracing_missing',
    });

    const response = await POST(
      createRequest({
        expected_updated_at: CURRENT_UPDATED_AT,
      }),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    await expectNeutralLinkedTracingReportValidationError(response);
    expect(tracingReportFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'tracing_missing', org_id: 'org_1' },
      select: expect.any(Object),
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(taskUpsertMock).not.toHaveBeenCalled();
    expect(tracingReportUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns the generic linked validation error when tracing report scope does not match', async () => {
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      status: 'responded',
      updated_at: CURRENT_UPDATED_AT_DATE,
      subject: '服薬情報提供書の確認',
      recipient_name: '在宅主治医',
      related_entity_type: 'tracing_report',
      related_entity_id: 'tracing_2',
    });
    tracingReportFindFirstMock.mockResolvedValue({
      id: 'tracing_2',
      patient_id: 'patient_1',
      case_id: 'case_2',
      status: 'received',
      sent_at: new Date('2026-06-17T00:00:00.000Z'),
      acknowledged_at: null,
    });

    const response = await POST(
      createRequest({
        expected_updated_at: CURRENT_UPDATED_AT,
      }),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    await expectNeutralLinkedTracingReportValidationError(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(taskUpsertMock).not.toHaveBeenCalled();
    expect(tracingReportUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns the same generic linked validation error when tracing report assignment access is denied', async () => {
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'driver_1',
        role: 'driver',
      },
    });
    communicationRequestFindFirstMock.mockResolvedValue({
      id: 'request_1',
      patient_id: 'patient_1',
      case_id: null,
      status: 'responded',
      updated_at: CURRENT_UPDATED_AT_DATE,
      subject: '服薬情報提供書の確認',
      recipient_name: '在宅主治医',
      related_entity_type: 'tracing_report',
      related_entity_id: 'tracing_2',
    });
    tracingReportFindFirstMock.mockResolvedValue({
      id: 'tracing_2',
      patient_id: 'patient_1',
      case_id: 'case_2',
      status: 'received',
      sent_at: new Date('2026-06-17T00:00:00.000Z'),
      acknowledged_at: null,
    });
    patientFindFirstMock
      .mockResolvedValueOnce({ id: 'patient_1' })
      .mockResolvedValueOnce({ id: 'patient_1', archived_at: null });
    careCaseFindFirstMock.mockResolvedValueOnce(null);

    const response = await POST(
      createRequest({
        expected_updated_at: CURRENT_UPDATED_AT,
      }),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    await expectNeutralLinkedTracingReportValidationError(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communicationRequestUpdateManyMock).not.toHaveBeenCalled();
    expect(communicationResponseCreateMock).not.toHaveBeenCalled();
    expect(taskUpsertMock).not.toHaveBeenCalled();
    expect(tracingReportUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
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
      select: {
        id: true,
        display_id: true,
      },
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

  it('rejects auth before resolving params or consuming malformed follow-up input', async () => {
    const request = new NextRequest(
      'http://localhost/api/communication-requests/request_1/resolve-followup',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      },
    );
    const paramsThenMock = vi.fn();
    const params = { then: paramsThenMock } as unknown as Promise<{ id: string }>;
    requireAuthContextMock.mockResolvedValueOnce({
      response: NextResponse.json(
        { code: 'FORBIDDEN', message: '連携依頼の更新権限がありません' },
        { status: 403 },
      ),
    });

    const response = await POST(request, { params });

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(request.bodyUsed).toBe(false);
    expect(paramsThenMock).not.toHaveBeenCalled();
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rethrows auth control-flow errors before params, body, or persistence', async () => {
    const controlFlowError = new Error('NEXT_REDIRECT');
    const request = createRequest({ expected_updated_at: CURRENT_UPDATED_AT });
    requireAuthContextMock.mockRejectedValueOnce(controlFlowError);
    unstableRethrowMock.mockImplementation((error) => {
      if (error === controlFlowError) throw error;
    });

    await expect(POST(request, { params: Promise.resolve({ id: 'request_1' }) })).rejects.toBe(
      controlFlowError,
    );

    expect(request.bodyUsed).toBe(false);
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it('rethrows handler control-flow errors without transaction or logging', async () => {
    const controlFlowError = new Error('NEXT_NOT_FOUND');
    communicationRequestFindFirstMock.mockRejectedValueOnce(controlFlowError);
    unstableRethrowMock.mockImplementation((error) => {
      if (error === controlFlowError) throw error;
    });

    await expect(
      POST(createRequest({ expected_updated_at: CURRENT_UPDATED_AT }), {
        params: Promise.resolve({ id: 'request_1' }),
      }),
    ).rejects.toBe(controlFlowError);

    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(authContext, expect.any(Function));
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when auth context fails before request loading', async () => {
    const unsafeError = new Error('raw communication followup auth patient 山田 花子 token secret');
    requireAuthContextMock.mockRejectedValueOnce(unsafeError);

    const response = await POST(
      createRequest({
        expected_updated_at: CURRENT_UPDATED_AT,
      }),
      { params: Promise.resolve({ id: 'request_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expect(response.headers.get('X-Request-Id')).toBe('generated_request_1');
    expect(response.headers.get('X-Correlation-Id')).toBe('correlation_1');
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
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_auth_unhandled_error',
        route: '/api/communication-requests/request_1/resolve-followup',
        method: 'POST',
        requestId: 'generated_request_1',
        correlationId: 'correlation_1',
      },
      unsafeError,
    );
  });

  it('returns a sanitized no-store 500 when follow-up transaction fails unexpectedly', async () => {
    const unsafeError = new Error(
      'raw followup transaction patient 山田 花子 token secret 夕食後薬',
    );
    withOrgContextMock.mockRejectedValueOnce(unsafeError);

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
    expect(response.headers.get('X-Request-Id')).toBe('request_1');
    expect(response.headers.get('X-Correlation-Id')).toBe('correlation_1');
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
    expect(loggerErrorMock).toHaveBeenCalledOnce();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_handler_unhandled_error',
        route: '/api/communication-requests/request_1/resolve-followup',
        method: 'POST',
        requestId: 'request_1',
        correlationId: 'correlation_1',
      },
      unsafeError,
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls[0]?.[0])).not.toContain('夕食後薬');
  });
});
