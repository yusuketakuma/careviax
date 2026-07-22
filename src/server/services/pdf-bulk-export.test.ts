import { unzipSync, strFromU8 } from 'fflate';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  zipSyncMock,
  transactionMock,
  integrationJobCountMock,
  integrationJobCreateMock,
  integrationJobUpdateManyMock,
  integrationJobFindUniqueMock,
  integrationJobFindFirstMock,
  integrationJobUpdateMock,
  membershipFindFirstMock,
  patientCountMock,
  visitScheduleFindManyMock,
  careCaseFindManyMock,
  auditLogCreateMock,
  notificationUpsertMock,
  buildMedicationHistoryPdfMock,
  storeGeneratedFileMock,
  deleteGeneratedFileMock,
  loggerWarnMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  zipSyncMock: vi.fn(),
  transactionMock: vi.fn(),
  integrationJobCountMock: vi.fn(),
  integrationJobCreateMock: vi.fn(),
  integrationJobUpdateManyMock: vi.fn(),
  integrationJobFindUniqueMock: vi.fn(),
  integrationJobFindFirstMock: vi.fn(),
  integrationJobUpdateMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  patientCountMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  notificationUpsertMock: vi.fn(),
  buildMedicationHistoryPdfMock: vi.fn(),
  storeGeneratedFileMock: vi.fn(),
  deleteGeneratedFileMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('fflate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fflate')>();
  zipSyncMock.mockImplementation(actual.zipSync);
  return {
    ...actual,
    zipSync: zipSyncMock,
  };
});

vi.mock('@/lib/db/client', () => ({
  prisma: {
    $transaction: transactionMock,
    integrationJob: {
      count: integrationJobCountMock,
      create: integrationJobCreateMock,
      updateMany: integrationJobUpdateManyMock,
      findUnique: integrationJobFindUniqueMock,
      findFirst: integrationJobFindFirstMock,
      update: integrationJobUpdateMock,
    },
    membership: {
      findFirst: membershipFindFirstMock,
    },
    patient: {
      count: patientCountMock,
    },
    visitSchedule: {
      findMany: visitScheduleFindManyMock,
    },
    careCase: {
      findMany: careCaseFindManyMock,
    },
    auditLog: {
      create: auditLogCreateMock,
    },
    notification: {
      upsert: notificationUpsertMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/pdf-documents', () => ({
  buildMedicationHistoryPdf: buildMedicationHistoryPdfMock,
}));

vi.mock('@/server/services/file-storage', () => ({
  storeGeneratedFile: storeGeneratedFileMock,
  deleteGeneratedFile: deleteGeneratedFileMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    warn: loggerWarnMock,
  },
}));

import {
  queueMedicationHistoryBulkExport,
  runMedicationHistoryBulkExportJob,
} from './pdf-bulk-export';

describe('pdf-bulk-export', () => {
  function transactionClient() {
    return {
      integrationJob: {
        count: integrationJobCountMock,
        create: integrationJobCreateMock,
        updateMany: integrationJobUpdateManyMock,
        findUnique: integrationJobFindUniqueMock,
        findFirst: integrationJobFindFirstMock,
      },
      patient: {
        count: patientCountMock,
      },
      visitSchedule: {
        findMany: visitScheduleFindManyMock,
      },
      careCase: {
        findMany: careCaseFindManyMock,
      },
      membership: {
        findFirst: membershipFindFirstMock,
      },
      auditLog: {
        create: auditLogCreateMock,
      },
      notification: {
        upsert: notificationUpsertMock,
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MEDICATION_HISTORY_BULK_EXPORT_MAX_TOTAL_PDF_BYTES;
    integrationJobCountMock.mockResolvedValue(0);
    patientCountMock.mockResolvedValue(2);
    integrationJobCreateMock.mockResolvedValue({ id: 'job_1' });
    integrationJobUpdateManyMock.mockResolvedValue({ count: 1 });
    integrationJobFindUniqueMock.mockResolvedValue({
      id: 'job_1',
      org_id: 'org_1',
      status: 'pending',
      job_type: 'medication-history-bulk-export',
      input: {
        version: 1,
        requestedBy: 'user_1',
        patientIds: ['patient_1', 'patient_2'],
      },
    });
    buildMedicationHistoryPdfMock
      .mockResolvedValueOnce({
        fileName: 'medications-patient_1.pdf',
        buffer: Buffer.from('%PDF-A'),
      })
      .mockResolvedValueOnce({
        fileName: 'medications-patient_2.pdf',
        buffer: Buffer.from('%PDF-B'),
      });
    storeGeneratedFileMock.mockResolvedValue({
      version: 1,
      id: 'file_1',
      orgId: 'org_1',
      purpose: 'bulk-export',
      storageKey: 'bulk-exports/org_1/job_1/file_1-medication-history.zip',
      originalName: 'medication-history.zip',
      mimeType: 'application/zip',
      sizeBytes: 32,
      status: 'uploaded',
      uploadedBy: 'user_1',
      jobId: 'job_1',
      createdAt: '2026-05-21T00:00:00.000Z',
      updatedAt: '2026-05-21T00:00:00.000Z',
      completedAt: '2026-05-21T00:00:00.000Z',
      downloadDisposition: 'attachment',
    });
    deleteGeneratedFileMock.mockResolvedValue(undefined);
    integrationJobUpdateMock.mockResolvedValue({});
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    visitScheduleFindManyMock.mockResolvedValue([]);
    careCaseFindManyMock.mockResolvedValue([]);
    auditLogCreateMock.mockResolvedValue({});
    notificationUpsertMock.mockResolvedValue({});
    transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(transactionClient()),
    );
    withOrgContextMock.mockImplementation(
      async (_orgId: string, callback: (tx: unknown) => Promise<unknown>) =>
        callback(transactionClient()),
    );
  });

  it('queues a medication history bulk export job', async () => {
    const result = await queueMedicationHistoryBulkExport({
      orgId: 'org_1',
      requestedBy: 'user_1',
      patientIds: [' patient_1 ', 'patient_2', 'patient_1'],
      accessContext: {
        userId: 'user_1',
        role: 'admin',
      },
      requestTrace: {
        requestId: 'request_bulk_1',
        correlationId: 'correlation_bulk_1',
      },
    });

    expect(result).toMatchObject({
      jobId: 'job_1',
      queuePosition: 1,
      patientCount: 2,
      startedImmediately: true,
    });
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: {
        userId: 'user_1',
        orgId: 'org_1',
        role: 'admin',
        requestId: 'request_bulk_1',
        correlationId: 'correlation_bulk_1',
      },
      isolationLevel: 'Serializable',
    });
    expect(transactionMock).not.toHaveBeenCalled();
    expect(integrationJobCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          job_type: 'medication-history-bulk-export',
          status: 'pending',
          org_id: 'org_1',
          input: expect.objectContaining({
            requestedBy: 'user_1',
            patientIds: ['patient_1', 'patient_2'],
            request_trace: {
              request_id: 'request_bulk_1',
              correlation_id: 'correlation_bulk_1',
            },
          }),
        }),
      }),
    );
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'export',
        target_type: 'medication_history',
        target_id: 'job_1',
        changes: expect.objectContaining({
          format: 'pdf',
          record_count: 2,
          metadata: {
            job_id: 'job_1',
            status: 'queued',
            patient_count: 2,
            requested_count: 2,
            patient_selection_hash: expect.any(String),
          },
          request_trace: {
            request_id: 'request_bulk_1',
            correlation_id: 'correlation_bulk_1',
          },
        }),
      }),
    });
    expect(JSON.stringify(auditLogCreateMock.mock.calls)).not.toContain('patient_1');
    expect(JSON.stringify(auditLogCreateMock.mock.calls)).not.toContain('patient_2');
  });

  it.each([
    {
      label: 'partial',
      requestTrace: { requestId: 'request_bulk_1' },
    },
    {
      label: 'invalid',
      requestTrace: {
        requestId: 'request bulk 1',
        correlationId: 'correlation_bulk_1',
      },
    },
  ])('atomically drops a $label queue trace pair', async ({ requestTrace }) => {
    await queueMedicationHistoryBulkExport({
      orgId: 'org_1',
      requestedBy: 'user_1',
      patientIds: ['patient_1', 'patient_2'],
      accessContext: {
        userId: 'user_1',
        role: 'admin',
      },
      requestTrace,
    });

    expect(integrationJobCreateMock.mock.calls[0]?.[0]?.data.input).not.toHaveProperty(
      'request_trace',
    );
    expect(auditLogCreateMock.mock.calls[0]?.[0]?.data.changes).not.toHaveProperty('request_trace');
  });

  it('rejects blank patient ids before queueing a medication history bulk export job', async () => {
    await expect(
      queueMedicationHistoryBulkExport({
        orgId: 'org_1',
        requestedBy: 'user_1',
        patientIds: ['patient_1', '   '],
        accessContext: {
          userId: 'user_1',
          role: 'admin',
        },
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(integrationJobCreateMock).not.toHaveBeenCalled();
  });

  it('reapplies the same org and actor RLS context when a serializable enqueue retries', async () => {
    withOrgContextMock
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('write conflict', {
          code: 'P2034',
          clientVersion: 'test',
        }),
      )
      .mockImplementationOnce(async (_orgId: string, callback: (tx: unknown) => Promise<unknown>) =>
        callback(transactionClient()),
      );

    await expect(
      queueMedicationHistoryBulkExport({
        orgId: 'org_1',
        requestedBy: 'user_1',
        patientIds: ['patient_1', 'patient_2'],
        accessContext: { userId: 'user_1', role: 'admin' },
        auditContext: { ipAddress: '203.0.113.10', userAgent: 'vitest' },
        requestTrace: {
          requestId: 'request_bulk_1',
          correlationId: 'correlation_bulk_1',
        },
      }),
    ).resolves.toMatchObject({ jobId: 'job_1' });

    expect(withOrgContextMock).toHaveBeenCalledTimes(2);
    expect(withOrgContextMock.mock.calls[0]?.[0]).toBe('org_1');
    expect(withOrgContextMock.mock.calls[1]?.[0]).toBe('org_1');
    expect(withOrgContextMock.mock.calls[0]?.[2]).toEqual(withOrgContextMock.mock.calls[1]?.[2]);
    expect(withOrgContextMock.mock.calls[1]?.[2]).toMatchObject({
      requestContext: {
        userId: 'user_1',
        orgId: 'org_1',
        role: 'admin',
        ipAddress: '203.0.113.10',
        userAgent: 'vitest',
        requestId: 'request_bulk_1',
        correlationId: 'correlation_bulk_1',
      },
      isolationLevel: 'Serializable',
    });
    expect(integrationJobCreateMock).toHaveBeenCalledOnce();
    expect(auditLogCreateMock).toHaveBeenCalledOnce();
  });

  it('propagates audit write failures so the queue transaction can roll back', async () => {
    auditLogCreateMock.mockRejectedValue(new Error('audit unavailable'));

    await expect(
      queueMedicationHistoryBulkExport({
        orgId: 'org_1',
        requestedBy: 'user_1',
        patientIds: ['patient_1', 'patient_2'],
        accessContext: {
          userId: 'user_1',
          role: 'admin',
        },
      }),
    ).rejects.toThrow('audit unavailable');
    expect(auditLogCreateMock).toHaveBeenCalledOnce();
  });

  it('queues an org-wide bulk export without per-patient assignment scoping', async () => {
    careCaseFindManyMock.mockResolvedValue([
      {
        patient_id: 'patient_2',
        primary_pharmacist_id: 'user_1',
        backup_pharmacist_id: null,
      },
    ]);

    const result = await queueMedicationHistoryBulkExport({
      orgId: 'org_1',
      requestedBy: 'user_1',
      patientIds: ['patient_1', 'patient_2'],
      accessContext: {
        userId: 'user_1',
        role: 'pharmacist',
      },
    });

    expect(result).toMatchObject({
      jobId: 'job_1',
      patientCount: 2,
    });
    expect(integrationJobCreateMock).toHaveBeenCalledOnce();
    // 組織内フルアクセスロールは担当割当スキャンを行わない。
    expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
  });

  it('queues an org-wide bulk export for same-org patients regardless of assignment', async () => {
    careCaseFindManyMock.mockResolvedValue([]);

    const result = await queueMedicationHistoryBulkExport({
      orgId: 'org_1',
      requestedBy: 'user_1',
      patientIds: ['patient_1', 'patient_2'],
      accessContext: {
        userId: 'user_1',
        role: 'pharmacist',
      },
    });

    expect(result).toMatchObject({
      jobId: 'job_1',
      patientCount: 2,
    });
    expect(integrationJobCreateMock).toHaveBeenCalledOnce();
  });

  it('rejects bulk export queue requests when the caller lacks visit permission', async () => {
    await expect(
      queueMedicationHistoryBulkExport({
        orgId: 'org_1',
        requestedBy: 'user_1',
        patientIds: ['patient_1'],
        accessContext: {
          userId: 'user_1',
          role: 'clerk',
        },
      }),
    ).rejects.toMatchObject({
      code: 'AUTHORIZATION_ERROR',
      status: 403,
    });
    expect(integrationJobCountMock).not.toHaveBeenCalled();
  });

  it('renders PDFs, stores an attachment ZIP, and notifies the requester', async () => {
    integrationJobFindFirstMock.mockResolvedValue(null);
    const storedFileId = 'file/../1?x=1#frag';
    storeGeneratedFileMock.mockResolvedValueOnce({
      version: 1,
      id: storedFileId,
      orgId: 'org_1',
      purpose: 'bulk-export',
      storageKey: 'bulk-exports/org_1/job_1/file-hostile-medication-history.zip',
      originalName: 'medication-history.zip',
      mimeType: 'application/zip',
      sizeBytes: 32,
      status: 'uploaded',
      uploadedBy: 'user_1',
      jobId: 'job_1',
      createdAt: '2026-05-21T00:00:00.000Z',
      updatedAt: '2026-05-21T00:00:00.000Z',
      completedAt: '2026-05-21T00:00:00.000Z',
      downloadDisposition: 'attachment',
    });

    const result = await runMedicationHistoryBulkExportJob('job_1', 'org_1');

    expect(result).toMatchObject({
      jobId: 'job_1',
      fileId: storedFileId,
      patientCount: 2,
    });
    expect(buildMedicationHistoryPdfMock).toHaveBeenNthCalledWith(
      1,
      'org_1',
      'patient_1',
      { userId: 'user_1', role: 'admin' },
      { runDb: expect.any(Function) },
    );
    expect(buildMedicationHistoryPdfMock).toHaveBeenNthCalledWith(
      2,
      'org_1',
      'patient_2',
      { userId: 'user_1', role: 'admin' },
      { runDb: expect.any(Function) },
    );
    expect(storeGeneratedFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org_1',
        purpose: 'bulk-export',
        mimeType: 'application/zip',
        uploadedBy: 'user_1',
        jobId: 'job_1',
        downloadDisposition: 'attachment',
      }),
    );

    const zipBuffer = storeGeneratedFileMock.mock.calls[0]?.[0]?.buffer as Buffer;
    const entries = unzipSync(new Uint8Array(zipBuffer));
    expect(strFromU8(entries['medications-patient_1.pdf'] ?? new Uint8Array())).toBe('%PDF-A');
    expect(strFromU8(entries['medications-patient_2.pdf'] ?? new Uint8Array())).toBe('%PDF-B');

    expect(notificationUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          user_id: 'user_1',
          link: `/api/files/${encodeURIComponent(storedFileId)}/download`,
          metadata: expect.objectContaining({
            file_id: storedFileId,
          }),
        }),
      }),
    );
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'export',
        target_type: 'medication_history',
        target_id: 'job_1',
        changes: expect.objectContaining({
          format: 'zip',
          record_count: 2,
          metadata: {
            job_id: 'job_1',
            requested_count: 2,
            success_count: 2,
            failed_count: 0,
            failure_codes: {
              pdf_not_found: 0,
              render_failed: 0,
            },
            patient_selection_hash: expect.any(String),
          },
        }),
      }),
    });
    expect(JSON.stringify(auditLogCreateMock.mock.calls)).not.toContain(storedFileId);
    expect(transactionMock).not.toHaveBeenCalled();
    expect(withOrgContextMock.mock.calls.every(([orgId]) => orgId === 'org_1')).toBe(true);
  });

  it('does not claim a bulk export job through a different organization context', async () => {
    integrationJobFindUniqueMock.mockResolvedValueOnce({
      id: 'job_1',
      org_id: 'org_2',
      status: 'pending',
      job_type: 'medication-history-bulk-export',
      input: {
        version: 1,
        requestedBy: 'user_1',
        patientIds: ['patient_1'],
      },
    });

    await expect(runMedicationHistoryBulkExportJob('job_1', 'org_1')).rejects.toMatchObject({
      code: 'WORKFLOW_NOT_FOUND',
      status: 404,
    });

    expect(withOrgContextMock).toHaveBeenCalledWith(
      'org_1',
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    );
    expect(integrationJobUpdateManyMock).not.toHaveBeenCalled();
    expect(buildMedicationHistoryPdfMock).not.toHaveBeenCalled();
    expect(notificationUpsertMock).not.toHaveBeenCalled();
  });

  it('preserves a valid queued trace in completed terminal input and the export audit', async () => {
    integrationJobFindFirstMock.mockResolvedValue(null);
    integrationJobFindUniqueMock.mockResolvedValueOnce({
      id: 'job_1',
      org_id: 'org_1',
      status: 'pending',
      job_type: 'medication-history-bulk-export',
      input: {
        version: 1,
        requestedBy: 'user_1',
        patientIds: ['patient_1', 'patient_2'],
        request_trace: {
          request_id: 'request_bulk_1',
          correlation_id: 'correlation_bulk_1',
        },
      },
    });

    await expect(runMedicationHistoryBulkExportJob('job_1', 'org_1')).resolves.toMatchObject({
      jobId: 'job_1',
      fileId: 'file_1',
      patientCount: 2,
    });

    expect(integrationJobUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'completed',
          input: expect.objectContaining({
            patient_count: 2,
            patient_selection_hash: expect.any(String),
            request_trace: {
              request_id: 'request_bulk_1',
              correlation_id: 'correlation_bulk_1',
            },
          }),
        }),
      }),
    );
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changes: expect.objectContaining({
          request_trace: {
            request_id: 'request_bulk_1',
            correlation_id: 'correlation_bulk_1',
          },
        }),
      }),
    });
  });

  it('drops a partial persisted trace without invalidating the export job', async () => {
    integrationJobFindFirstMock.mockResolvedValue(null);
    integrationJobFindUniqueMock.mockResolvedValueOnce({
      id: 'job_1',
      org_id: 'org_1',
      status: 'pending',
      job_type: 'medication-history-bulk-export',
      input: {
        version: 1,
        requestedBy: 'user_1',
        patientIds: ['patient_1', 'patient_2'],
        request_trace: {
          request_id: 'request_bulk_1',
        },
      },
    });

    await expect(runMedicationHistoryBulkExportJob('job_1', 'org_1')).resolves.toMatchObject({
      jobId: 'job_1',
      fileId: 'file_1',
      patientCount: 2,
    });

    const completedInput = integrationJobUpdateManyMock.mock.calls.find(
      ([call]) => call.data?.status === 'completed',
    )?.[0]?.data?.input;
    expect(completedInput).not.toHaveProperty('request_trace');
    expect(auditLogCreateMock.mock.calls[0]?.[0]?.data.changes).not.toHaveProperty('request_trace');
  });

  it('fails jobs with blank persisted patient ids before rendering PDFs', async () => {
    integrationJobFindFirstMock.mockResolvedValue(null);
    integrationJobFindUniqueMock.mockResolvedValueOnce({
      id: 'job_1',
      org_id: 'org_1',
      status: 'pending',
      job_type: 'medication-history-bulk-export',
      input: {
        version: 1,
        requestedBy: 'user_1',
        patientIds: ['patient_1', '   '],
        request_trace: {
          request_id: 'request_bulk_1',
          correlation_id: 'correlation_bulk_1',
        },
      },
    });

    await expect(runMedicationHistoryBulkExportJob('job_1', 'org_1')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: '一括出力ジョブの入力が不正です',
    });
    expect(buildMedicationHistoryPdfMock).not.toHaveBeenCalled();
    expect(patientCountMock).not.toHaveBeenCalled();
    expect(integrationJobUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'failed',
          error_log: '一括出力ジョブの入力が不正です',
          input: {
            version: 1,
            requestedBy: 'user_1',
            invalid_input: true,
            request_trace: {
              request_id: 'request_bulk_1',
              correlation_id: 'correlation_bulk_1',
            },
          },
          locked_at: null,
        }),
      }),
    );
    expect(JSON.stringify(integrationJobUpdateManyMock.mock.calls)).not.toContain('patient_1');
  });

  it('preserves a valid trace in failed terminal input without creating a failure audit', async () => {
    const rawFailure = 'storage unavailable patient=患者A token=secret';
    integrationJobFindFirstMock.mockResolvedValue(null);
    integrationJobFindUniqueMock.mockResolvedValueOnce({
      id: 'job_1',
      org_id: 'org_1',
      status: 'pending',
      job_type: 'medication-history-bulk-export',
      input: {
        version: 1,
        requestedBy: 'user_1',
        patientIds: ['patient_1', 'patient_2'],
        request_trace: {
          request_id: 'request_bulk_1',
          correlation_id: 'correlation_bulk_1',
        },
      },
    });
    storeGeneratedFileMock.mockRejectedValueOnce(new Error(rawFailure));

    await expect(runMedicationHistoryBulkExportJob('job_1', 'org_1')).rejects.toThrow(rawFailure);

    expect(integrationJobUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'failed',
          error_log: '薬歴 PDF ZIP の生成に失敗しました',
          input: expect.objectContaining({
            patient_count: 2,
            patient_selection_hash: expect.any(String),
            request_trace: {
              request_id: 'request_bulk_1',
              correlation_id: 'correlation_bulk_1',
            },
          }),
        }),
      }),
    );
    expect(JSON.stringify(integrationJobUpdateManyMock.mock.calls)).not.toContain('patient_1');
    expect(JSON.stringify(integrationJobUpdateManyMock.mock.calls)).not.toContain('patient_2');
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('audits partial exports with the actual successful PDF count', async () => {
    integrationJobFindFirstMock.mockResolvedValue(null);
    buildMedicationHistoryPdfMock
      .mockReset()
      .mockResolvedValueOnce({
        fileName: 'medications-patient_1.pdf',
        buffer: Buffer.from('%PDF-A'),
      })
      .mockRejectedValueOnce(new Error('database timeout'));

    const result = await runMedicationHistoryBulkExportJob('job_1', 'org_1');

    expect(result).toMatchObject({
      jobId: 'job_1',
      fileId: 'file_1',
      patientCount: 1,
      errors: ['PDF 生成に失敗しました'],
    });
    expect(integrationJobUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'completed',
          input: {
            version: 1,
            requestedBy: 'user_1',
            patient_count: 2,
            patient_selection_hash: expect.any(String),
          },
          output: expect.objectContaining({
            jobId: 'job_1',
            fileId: 'file_1',
            requestedCount: 2,
            patientCount: 1,
            failedCount: 1,
            failureCodes: {
              pdf_not_found: 0,
              render_failed: 1,
            },
          }),
        }),
      }),
    );
    const persistedUpdateJson = JSON.stringify(integrationJobUpdateManyMock.mock.calls);
    expect(persistedUpdateJson).not.toContain('patient_1');
    expect(persistedUpdateJson).not.toContain('patient_2');
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        target_type: 'medication_history',
        target_id: 'job_1',
        changes: expect.objectContaining({
          format: 'zip',
          record_count: 1,
          metadata: {
            job_id: 'job_1',
            file_id: 'file_1',
            requested_count: 2,
            success_count: 1,
            failed_count: 1,
            failure_codes: {
              pdf_not_found: 0,
              render_failed: 1,
            },
            patient_selection_hash: expect.any(String),
          },
        }),
      }),
    });
    expect(JSON.stringify(auditLogCreateMock.mock.calls)).not.toContain('patient_2');
  });
});
