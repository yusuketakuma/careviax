import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  authContext,
  requireAuthContextMock,
  runWithRequestAuthContextMock,
  loggerErrorMock,
  withRoutePerformanceMock,
  withOrgContextMock,
  canAccessCareReportSourceMock,
  careReportFindFirstMock,
  careReportUpdateManyMock,
  pharmacistCredentialFindManyMock,
  careReportRevisionCreateMock,
  auditLogCreateMock,
  allocateDisplayIdMock,
} = vi.hoisted(() => ({
  authContext: {
    userId: 'pharmacist_1',
    orgId: 'org_1',
    role: 'pharmacist',
    requestId: 'request_finalize_1',
    correlationId: 'correlation_finalize_1',
  },
  requireAuthContextMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn((_ctx, callback) => callback()),
  loggerErrorMock: vi.fn(),
  withRoutePerformanceMock: vi.fn((_req, handler) => handler()),
  withOrgContextMock: vi.fn(),
  canAccessCareReportSourceMock: vi.fn(),
  careReportFindFirstMock: vi.fn(),
  careReportUpdateManyMock: vi.fn(),
  pharmacistCredentialFindManyMock: vi.fn(),
  careReportRevisionCreateMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  allocateDisplayIdMock: vi.fn(),
}));

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
        let response: Response;
        let trace = authContext;
        try {
          const authResult = await requireAuthContextMock(req, options);
          if ('response' in authResult) {
            response = authResult.response;
          } else {
            trace = authResult.ctx;
            try {
              response = await runWithRequestAuthContextMock(authResult.ctx, () =>
                handler(req, authResult.ctx, routeContext),
              );
            } catch (error) {
              loggerErrorMock(
                {
                  event: 'route_handler_unhandled_error',
                  route: req.nextUrl.pathname,
                  method: req.method,
                  requestId: trace.requestId,
                  correlationId: trace.correlationId,
                },
                error,
              );
              response = NextResponse.json(
                { code: 'INTERNAL_ERROR', message: 'サーバー内部でエラーが発生しました' },
                { status: 500 },
              );
            }
          }
        } catch (error) {
          trace = {
            ...authContext,
            requestId: 'generated_request_finalize_1',
            correlationId: req.headers.get('x-correlation-id') ?? 'generated_request_finalize_1',
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
          response = NextResponse.json(
            { code: 'INTERNAL_ERROR', message: 'サーバー内部でエラーが発生しました' },
            { status: 500 },
          );
        }
        response.headers.set('Cache-Control', 'private, no-store, max-age=0');
        response.headers.set('Pragma', 'no-cache');
        response.headers.set('X-Request-Id', trace.requestId);
        response.headers.set('X-Correlation-Id', trace.correlationId);
        return response;
      }),
}));

vi.mock('@/server/services/care-report-access', () => ({
  canAccessCareReportSource: canAccessCareReportSourceMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/db/display-id', () => ({
  allocateDisplayId: allocateDisplayIdMock,
}));

import {
  buildFinalizedCareReportContentSnapshot,
  computeFinalizedCareReportContentHash,
} from '@/server/services/care-report-finalization';
import { POST } from './route';

const REPORT_UPDATED_AT = new Date('2026-03-30T00:10:00.000Z');
const REPORT_UPDATED_AT_ISO = REPORT_UPDATED_AT.toISOString();

function createRequest(body: unknown = { expected_updated_at: REPORT_UPDATED_AT_ISO }) {
  return new NextRequest('http://localhost/api/care-reports/report_1/finalize', {
    method: 'POST',
    headers: {
      'x-org-id': 'org_1',
      'content-type': 'application/json',
      'x-request-id': 'inbound_request_should_be_ignored',
      'x-correlation-id': 'correlation_finalize_1',
    },
    body: JSON.stringify(body),
  });
}

function baseReport() {
  return {
    id: 'report_1',
    patient_id: 'patient_1',
    case_id: 'case_1',
    visit_record_id: 'visit_record_1',
    status: 'draft',
    content: {
      summary: '医師へ共有する本文',
      billing_context: { billing_evidence_id: 'billing_1' },
      source_provenance: { visit_record_id: 'visit_record_1' },
      warnings: ['臨床上の注意'],
      report_delivery_targets: [{ delivery_record_id: 'delivery_1' }],
    },
    updated_at: REPORT_UPDATED_AT,
    finalized_at: null,
    locked_at: null,
    voided_at: null,
    report_revision: 1,
    pdf_hash: null,
  };
}

describe('/api/care-reports/[id]/finalize POST', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireAuthContextMock.mockResolvedValue({ ctx: authContext });
    runWithRequestAuthContextMock.mockImplementation((_ctx, callback) => callback());
    withRoutePerformanceMock.mockImplementation((_req, handler) => handler());
    canAccessCareReportSourceMock.mockResolvedValue(true);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        careReport: {
          findFirst: careReportFindFirstMock,
          updateMany: careReportUpdateManyMock,
        },
        pharmacistCredential: {
          findMany: pharmacistCredentialFindManyMock,
        },
        careReportRevision: {
          create: careReportRevisionCreateMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
    careReportFindFirstMock.mockResolvedValueOnce(baseReport()).mockResolvedValueOnce({
      id: 'report_1',
      status: 'draft',
      finalized_at: new Date('2026-03-30T01:00:00.000Z'),
      finalized_by: 'pharmacist_1',
      locked_at: new Date('2026-03-30T01:00:00.000Z'),
      locked_by: 'pharmacist_1',
      report_revision: 1,
      content_hash: 'hash_after_update',
      updated_at: new Date('2026-03-30T01:00:00.000Z'),
      finalized_pharmacist_credential_id: 'cred_1',
      finalized_credential_type: 'licensed_pharmacist',
      finalized_credential_role_snapshot: 'pharmacist',
      finalized_credential_checked_at: new Date('2026-03-30T01:00:00.000Z'),
    });
    pharmacistCredentialFindManyMock.mockResolvedValue([
      {
        id: 'cred_1',
        certification_type: 'licensed_pharmacist',
        certification_number: 'license-secret-123',
        expiry_date: new Date('2099-01-01T00:00:00.000Z'),
      },
    ]);
    careReportUpdateManyMock.mockResolvedValue({ count: 1 });
    careReportRevisionCreateMock.mockResolvedValue({ id: 'revision_1' });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    allocateDisplayIdMock.mockResolvedValue('crev0000000001');
  });

  it('builds the finalized content snapshot from clinical fields and excludes delivery metadata only', () => {
    const snapshot = buildFinalizedCareReportContentSnapshot({
      z: 1,
      source_provenance: { visit_record_id: 'visit_record_1' },
      billing_context: { billing_evidence_id: 'billing_1' },
      warnings: ['臨床上の注意'],
      report_delivery_targets: [{ delivery_record_id: 'delivery_1' }],
    });

    expect(snapshot).toEqual({
      z: 1,
      source_provenance: { visit_record_id: 'visit_record_1' },
      billing_context: { billing_evidence_id: 'billing_1' },
      warnings: ['臨床上の注意'],
    });
    expect(computeFinalizedCareReportContentHash({ b: 2, a: 1 })).toBe(
      computeFinalizedCareReportContentHash({ a: 1, b: 2 }),
    );
  });

  it('finalizes a draft with an active same-user credential, revision snapshot, and redacted audit', async () => {
    const response = await POST(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(response.headers.get('X-Request-Id')).toBe('request_finalize_1');
    expect(response.headers.get('X-Correlation-Id')).toBe('correlation_finalize_1');
    expect(withRoutePerformanceMock).toHaveBeenCalledOnce();
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(authContext, expect.any(Function));
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.anything(), {
      permission: 'canAuthorReport',
      message: '報告書の確定権限がありません',
    });
    expect(pharmacistCredentialFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          user_id: 'pharmacist_1',
        },
      }),
    );
    const expectedHash = computeFinalizedCareReportContentHash(baseReport().content);
    expect(careReportUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'report_1',
        org_id: 'org_1',
        status: 'draft',
        updated_at: REPORT_UPDATED_AT,
        finalized_at: null,
        locked_at: null,
        voided_at: null,
      },
      data: expect.objectContaining({
        finalized_by: 'pharmacist_1',
        locked_by: 'pharmacist_1',
        content_hash: expectedHash,
        finalized_pharmacist_credential_id: 'cred_1',
        finalized_credential_type: 'licensed_pharmacist',
        finalized_credential_number: 'license-secret-123',
        finalized_credential_role_snapshot: 'pharmacist',
      }),
    });
    expect(allocateDisplayIdMock).toHaveBeenCalledWith(
      expect.anything(),
      'CareReportRevision',
      'org_1',
    );
    expect(careReportRevisionCreateMock).toHaveBeenCalledWith({
      data: {
        org_id: 'org_1',
        display_id: 'crev0000000001',
        report_id: 'report_1',
        revision_no: 1,
        content_snapshot: {
          summary: '医師へ共有する本文',
          billing_context: { billing_evidence_id: 'billing_1' },
          source_provenance: { visit_record_id: 'visit_record_1' },
          warnings: ['臨床上の注意'],
        },
        content_hash: expectedHash,
        pdf_hash: null,
        created_by: 'pharmacist_1',
      },
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'care_report_finalized',
        target_type: 'care_report',
        target_id: 'report_1',
        patient_id: 'patient_1',
        changes: expect.objectContaining({
          revision_no: 1,
          content_hash: expectedHash,
          credential_id: 'cred_1',
          credential_type: 'licensed_pharmacist',
        }),
      }),
    });
    expect(JSON.stringify(auditLogCreateMock.mock.calls)).not.toContain('license-secret-123');
    expect(careReportUpdateManyMock.mock.invocationCallOrder[0]).toBeLessThan(
      careReportRevisionCreateMock.mock.invocationCallOrder[0]!,
    );
    expect(careReportRevisionCreateMock.mock.invocationCallOrder[0]).toBeLessThan(
      auditLogCreateMock.mock.invocationCallOrder[0]!,
    );
    expect(auditLogCreateMock.mock.invocationCallOrder[0]).toBeLessThan(
      careReportFindFirstMock.mock.invocationCallOrder[1]!,
    );
  });

  it('rejects pharmacist trainee finalization before credential lookup or report mutation', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      ctx: {
        userId: 'trainee_1',
        orgId: 'org_1',
        role: 'pharmacist_trainee',
        requestId: 'request_trainee_1',
        correlationId: 'correlation_finalize_1',
      },
    });

    const response = await POST(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careReportFindFirstMock).not.toHaveBeenCalled();
    expect(pharmacistCredentialFindManyMock).not.toHaveBeenCalled();
    expect(careReportUpdateManyMock).not.toHaveBeenCalled();
    expect(careReportRevisionCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects stale finalize attempts without revision or audit side effects', async () => {
    careReportUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await POST(
      createRequest({ expected_updated_at: '2026-03-30T00:09:00.000Z' }),
      {
        params: Promise.resolve({ id: 'report_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    expect(careReportRevisionCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns 409 when the actor has no active pharmacist credential', async () => {
    pharmacistCredentialFindManyMock.mockResolvedValueOnce([
      {
        id: 'cred_expired',
        certification_type: 'licensed_pharmacist',
        certification_number: 'expired-secret',
        expiry_date: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);

    const response = await POST(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    expect(careReportUpdateManyMock).not.toHaveBeenCalled();
    expect(careReportRevisionCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects wrapper authorization before the clinical handler or database work', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: NextResponse.json(
        { code: 'FORBIDDEN', message: '報告書の確定権限がありません' },
        { status: 403 },
      ),
    });

    const response = await POST(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careReportFindFirstMock).not.toHaveBeenCalled();
    expect(pharmacistCredentialFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects source-inaccessible reports before credential lookup or mutation', async () => {
    canAccessCareReportSourceMock.mockResolvedValueOnce(false);

    const response = await POST(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(canAccessCareReportSourceMock).toHaveBeenCalledWith(
      expect.anything(),
      'org_1',
      authContext,
      {
        patientId: 'patient_1',
        caseId: 'case_1',
        visitRecordId: 'visit_record_1',
      },
    );
    expect(pharmacistCredentialFindManyMock).not.toHaveBeenCalled();
    expect(careReportUpdateManyMock).not.toHaveBeenCalled();
    expect(careReportRevisionCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('requires an explicit credential when multiple active credentials match', async () => {
    pharmacistCredentialFindManyMock.mockResolvedValueOnce([
      {
        id: 'cred_1',
        certification_type: 'licensed_pharmacist',
        certification_number: 'license-secret-123',
        expiry_date: new Date('2099-01-01T00:00:00.000Z'),
      },
      {
        id: 'cred_2',
        certification_type: 'home_care_specialist',
        certification_number: 'license-secret-456',
        expiry_date: new Date('2099-01-01T00:00:00.000Z'),
      },
    ]);

    const response = await POST(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '確定に使用する薬剤師資格を指定してください',
    });
    expect(pharmacistCredentialFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { org_id: 'org_1', user_id: 'pharmacist_1' },
        take: 2,
      }),
    );
    expect(careReportUpdateManyMock).not.toHaveBeenCalled();
    expect(careReportRevisionCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('scopes an explicitly selected credential to the current org and user', async () => {
    const response = await POST(
      createRequest({
        expected_updated_at: REPORT_UPDATED_AT_ISO,
        pharmacist_credential_id: 'cred_1',
      }),
      { params: Promise.resolve({ id: 'report_1' }) },
    );

    expect(response.status).toBe(200);
    expect(pharmacistCredentialFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          user_id: 'pharmacist_1',
          id: 'cred_1',
        },
        take: 1,
      }),
    );
  });

  it('returns a traced PHI-safe 500 when the handler dependency throws', async () => {
    const thrownError = new Error('DB failure for 患者A license-secret-123');
    withOrgContextMock.mockRejectedValueOnce(thrownError);

    const response = await POST(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expect(response.headers.get('X-Request-Id')).toBe('request_finalize_1');
    expect(response.headers.get('X-Correlation-Id')).toBe('correlation_finalize_1');
    const bodyText = await response.text();
    expect(bodyText).not.toContain('患者A');
    expect(bodyText).not.toContain('license-secret-123');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_handler_unhandled_error',
        route: '/api/care-reports/report_1/finalize',
        method: 'POST',
        requestId: 'request_finalize_1',
        correlationId: 'correlation_finalize_1',
      },
      thrownError,
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls[0]?.[0])).not.toContain('患者A');
    expect(careReportUpdateManyMock).not.toHaveBeenCalled();
    expect(careReportRevisionCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns a generated traced no-store 500 when the auth dependency throws', async () => {
    const thrownError = new Error('session provider unavailable');
    requireAuthContextMock.mockRejectedValueOnce(thrownError);

    const response = await POST(createRequest(), {
      params: Promise.resolve({ id: 'report_1' }),
    });

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expect(response.headers.get('X-Request-Id')).toBe('generated_request_finalize_1');
    expect(response.headers.get('X-Correlation-Id')).toBe('correlation_finalize_1');
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_auth_unhandled_error',
        route: '/api/care-reports/report_1/finalize',
        method: 'POST',
        requestId: 'generated_request_finalize_1',
        correlationId: 'correlation_finalize_1',
      },
      thrownError,
    );
  });
});
