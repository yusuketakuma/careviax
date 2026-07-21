import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  requireAuthContextMock,
  queueMedicationHistoryBulkExportMock,
  drainMedicationHistoryBulkExportQueueMock,
  loggerWarnMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  queueMedicationHistoryBulkExportMock: vi.fn(),
  drainMedicationHistoryBulkExportQueueMock: vi.fn(),
  loggerWarnMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext:
    (
      handler: (req: NextRequest, ctx: Record<string, unknown>) => Promise<Response>,
      options?: unknown,
    ) =>
    async (req: NextRequest) => {
      const noStore = (response: Response) => {
        response.headers.set('Cache-Control', 'private, no-store, max-age=0');
        response.headers.set('Pragma', 'no-cache');
        return response;
      };
      try {
        const authResult = await requireAuthContextMock(req, options);
        if ('response' in authResult) return noStore(authResult.response);
        const response = noStore(await handler(req, authResult.ctx));
        response.headers.set('x-request-id', authResult.ctx.requestId);
        response.headers.set('x-correlation-id', authResult.ctx.correlationId);
        return response;
      } catch {
        return noStore(
          Response.json(
            { code: 'INTERNAL_ERROR', message: 'サーバー内部でエラーが発生しました' },
            { status: 500 },
          ),
        );
      }
    },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

vi.mock('@/server/services/export-audit', () => ({
  recordDataExportAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/server/services/pdf-bulk-export', () => ({
  MedicationHistoryBulkExportError: class MedicationHistoryBulkExportError extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  },
  queueMedicationHistoryBulkExport: queueMedicationHistoryBulkExportMock,
  drainMedicationHistoryBulkExportQueue: drainMedicationHistoryBulkExportQueueMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    warn: loggerWarnMock,
  },
}));

import { POST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };

function callPOST(request: NextRequest) {
  return POST(request, emptyRouteContext);
}

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/patients/medications/bulk-export', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/patients/medications/bulk-export', {
    method: 'POST',
    body: '{"patient_ids":',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

function expectRequestTrace(
  response: Response,
  requestId = 'request_bulk_1',
  correlationId = 'correlation_bulk_1',
) {
  expect(response.headers.get('x-request-id')).toBe(requestId);
  expect(response.headers.get('x-correlation-id')).toBe(correlationId);
}

describe('/api/patients/medications/bulk-export POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        userId: 'user_1',
        orgId: 'org_1',
        role: 'admin',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
        requestId: 'request_bulk_1',
        correlationId: 'correlation_bulk_1',
      },
    });
    queueMedicationHistoryBulkExportMock.mockResolvedValue({
      jobId: 'job_1',
      queuePosition: 1,
      patientCount: 2,
      startedImmediately: true,
    });
    drainMedicationHistoryBulkExportQueueMock.mockResolvedValue({
      processedCount: 2,
      errors: [],
    });
  });

  it('queues a bulk export and returns 202', async () => {
    const response = await callPOST(
      createRequest({
        patient_ids: [' patient_1 ', 'patient_2', 'patient_1'],
      }),
    );

    if (!response) {
      throw new Error('Expected a response from bulk export POST');
    }
    expect(response.status).toBe(202);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    expect(queueMedicationHistoryBulkExportMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      requestedBy: 'user_1',
      patientIds: ['patient_1', 'patient_2'],
      accessContext: {
        userId: 'user_1',
        role: 'admin',
      },
      auditContext: {
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      },
      requestTrace: {
        requestId: 'request_bulk_1',
        correlationId: 'correlation_bulk_1',
      },
    });
    expect(drainMedicationHistoryBulkExportQueueMock).toHaveBeenCalledWith({
      orgId: 'org_1',
    });
  });

  it('does not drain immediately when the queue already has running work', async () => {
    queueMedicationHistoryBulkExportMock.mockResolvedValue({
      jobId: 'job_2',
      queuePosition: 2,
      patientCount: 2,
      startedImmediately: false,
    });

    const response = await callPOST(
      createRequest({
        patient_ids: ['patient_1', 'patient_2'],
      }),
    );

    if (!response) {
      throw new Error('Expected a response from queued bulk export POST');
    }
    expect(response.status).toBe(202);
    expect(drainMedicationHistoryBulkExportQueueMock).not.toHaveBeenCalled();
  });

  it('logs a safe warning when immediate background drain fails', async () => {
    const rawError = '患者A medication-history raw export token=secret drain failed';
    drainMedicationHistoryBulkExportQueueMock.mockRejectedValueOnce(new Error(rawError));

    const response = await callPOST(createRequest({ patient_ids: ['patient_1'] }));
    await Promise.resolve();

    if (!response) {
      throw new Error('Expected a response from bulk export POST with failed drain');
    }
    expect(response.status).toBe(202);
    expectSensitiveNoStore(response);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      {
        event: 'medication_history_bulk_export.drain_failed',
        orgId: 'org_1',
        targetId: 'job_1',
        jobType: 'medication-history-bulk-export-drain',
        operation: 'drain',
        requestId: 'request_bulk_1',
        correlationId: 'correlation_bulk_1',
      },
      expect.any(Error),
    );
    expect(JSON.stringify(loggerWarnMock.mock.calls[0]?.[0])).not.toContain(rawError);
    expect(JSON.stringify(loggerWarnMock.mock.calls[0]?.[0])).not.toContain('患者A');
    expect(JSON.stringify(loggerWarnMock.mock.calls[0]?.[0])).not.toContain('token=secret');
  });

  it('returns 400 for invalid payloads', async () => {
    const response = await callPOST(createRequest({ patient_ids: [] }));

    if (!response) {
      throw new Error('Expected a response from invalid bulk export POST');
    }
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    expect(queueMedicationHistoryBulkExportMock).not.toHaveBeenCalled();
  });

  it('preserves the authenticated request trace on known workflow errors', async () => {
    const { MedicationHistoryBulkExportError } = await import('@/server/services/pdf-bulk-export');
    queueMedicationHistoryBulkExportMock.mockRejectedValueOnce(
      new MedicationHistoryBulkExportError('WORKFLOW_CONFLICT', 'queue full', 409),
    );

    const response = await callPOST(createRequest({ patient_ids: ['patient_1'] }));

    if (!response) {
      throw new Error('Expected a response from conflicted bulk export POST');
    }
    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
  });

  it('rejects blank patient ids before queueing work', async () => {
    const response = await callPOST(createRequest({ patient_ids: ['patient_1', '   '] }));

    if (!response) {
      throw new Error('Expected a response from blank patient id bulk export POST');
    }
    expect(response.status).toBe(400);
    expect(queueMedicationHistoryBulkExportMock).not.toHaveBeenCalled();
    expect(drainMedicationHistoryBulkExportQueueMock).not.toHaveBeenCalled();
  });

  it('rejects non-object export payloads before queueing work', async () => {
    const response = await callPOST(createRequest([]));

    if (!response) {
      throw new Error('Expected a response from non-object bulk export POST');
    }
    expect(response.status).toBe(400);
    expect(queueMedicationHistoryBulkExportMock).not.toHaveBeenCalled();
    expect(drainMedicationHistoryBulkExportQueueMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON export payloads before queueing work', async () => {
    const response = await callPOST(createMalformedJsonRequest());

    if (!response) {
      throw new Error('Expected a response from malformed JSON bulk export POST');
    }
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(queueMedicationHistoryBulkExportMock).not.toHaveBeenCalled();
    expect(drainMedicationHistoryBulkExportQueueMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when queue registration fails unexpectedly', async () => {
    const rawError = '患者A medication-history raw export token=secret failed';
    queueMedicationHistoryBulkExportMock.mockRejectedValueOnce(new Error(rawError));

    const response = await callPOST(createRequest({ patient_ids: ['patient_1'] }));

    if (!response) {
      throw new Error('Expected a response from failed bulk export POST');
    }
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    const body = await response.text();
    expect(body).toContain('EXTERNAL_PDF_RENDER_FAILED');
    expect(body).not.toContain(rawError);
    expect(body).not.toContain('患者A');
    expect(body).not.toContain('token=secret');
    expect(drainMedicationHistoryBulkExportQueueMock).not.toHaveBeenCalled();
  });

  it('passes through the trace already attached to pre-auth failures', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: new Response(JSON.stringify({ code: 'UNAUTHORIZED' }), {
        status: 401,
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'request_auth_failure',
          'x-correlation-id': 'correlation_auth_failure',
        },
      }),
    });

    const response = await callPOST(createRequest({ patient_ids: ['patient_1'] }));

    if (!response) {
      throw new Error('Expected a response from unauthorized bulk export POST');
    }
    expect(response.status).toBe(401);
    expectSensitiveNoStore(response);
    expectRequestTrace(response, 'request_auth_failure', 'correlation_auth_failure');
    expect(queueMedicationHistoryBulkExportMock).not.toHaveBeenCalled();
  });
});
