import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  queueMedicationHistoryBulkExportMock,
  drainMedicationHistoryBulkExportQueueMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  queueMedicationHistoryBulkExportMock: vi.fn(),
  drainMedicationHistoryBulkExportQueueMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
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

import { POST } from './route';

function createRequest(body: unknown) {
  return {
    json: async () => body,
    headers: {
      get: (key: string) => ({ 'x-org-id': 'org_1' })[key] ?? null,
    },
  } as unknown as NextRequest;
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
    const response = await POST(
      createRequest({
        patient_ids: ['patient_1', 'patient_2'],
      }),
    );

    if (!response) {
      throw new Error('Expected a response from bulk export POST');
    }
    expect(response.status).toBe(202);
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

    const response = await POST(
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

  it('returns 400 for invalid payloads', async () => {
    const response = await POST(createRequest({ patient_ids: [] }));

    if (!response) {
      throw new Error('Expected a response from invalid bulk export POST');
    }
    expect(response.status).toBe(400);
    expect(queueMedicationHistoryBulkExportMock).not.toHaveBeenCalled();
  });
});
