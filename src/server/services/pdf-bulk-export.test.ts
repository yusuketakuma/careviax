import { unzipSync, strFromU8 } from 'fflate';
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
  drainMedicationHistoryBulkExportQueue,
  queueMedicationHistoryBulkExport,
  runMedicationHistoryBulkExportJob,
} from './pdf-bulk-export';

describe('pdf-bulk-export', () => {
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
      callback({
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
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
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
    });

    expect(result).toMatchObject({
      jobId: 'job_1',
      queuePosition: 1,
      patientCount: 2,
      startedImmediately: true,
    });
    expect(integrationJobCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          job_type: 'medication-history-bulk-export',
          status: 'pending',
          org_id: 'org_1',
          input: expect.objectContaining({
            requestedBy: 'user_1',
            patientIds: ['patient_1', 'patient_2'],
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
        }),
      }),
    });
    expect(JSON.stringify(auditLogCreateMock.mock.calls)).not.toContain('patient_1');
    expect(JSON.stringify(auditLogCreateMock.mock.calls)).not.toContain('patient_2');
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
    expect(transactionMock).not.toHaveBeenCalled();
    expect(integrationJobCreateMock).not.toHaveBeenCalled();
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

    const result = await runMedicationHistoryBulkExportJob('job_1');

    expect(result).toMatchObject({
      jobId: 'job_1',
      fileId: storedFileId,
      patientCount: 2,
    });
    expect(buildMedicationHistoryPdfMock).toHaveBeenNthCalledWith(1, 'org_1', 'patient_1');
    expect(buildMedicationHistoryPdfMock).toHaveBeenNthCalledWith(2, 'org_1', 'patient_2');
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
            file_id: storedFileId,
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
      },
    });

    await expect(runMedicationHistoryBulkExportJob('job_1')).rejects.toMatchObject({
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
          },
          locked_at: null,
        }),
      }),
    );
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

    const result = await runMedicationHistoryBulkExportJob('job_1');

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

  it('fails oversized rendered PDFs before zipping or storing the archive', async () => {
    process.env.MEDICATION_HISTORY_BULK_EXPORT_MAX_TOTAL_PDF_BYTES = '8';
    integrationJobFindFirstMock.mockResolvedValue(null);
    buildMedicationHistoryPdfMock
      .mockReset()
      .mockResolvedValueOnce({
        fileName: 'medications-patient_1.pdf',
        buffer: Buffer.from('%PDF-A'),
      })
      .mockResolvedValueOnce({
        fileName: 'medications-patient_2.pdf',
        buffer: Buffer.from('%PDF-B'),
      });

    await expect(runMedicationHistoryBulkExportJob('job_1')).rejects.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      status: 409,
      message: expect.stringContaining('合計サイズが上限'),
    });
    expect(zipSyncMock).not.toHaveBeenCalled();
    expect(storeGeneratedFileMock).not.toHaveBeenCalled();
    expect(integrationJobUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'job_1',
          status: 'running',
          locked_at: expect.any(Date),
        }),
        data: expect.objectContaining({
          status: 'failed',
          error_log: expect.stringContaining('合計サイズが上限'),
          locked_at: null,
        }),
      }),
    );
    expect(notificationUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          event_type: 'medication_history_bulk_export_failed',
          message: expect.stringContaining('合計サイズが上限'),
        }),
      }),
    );
  });

  it('ignores sub-byte configured PDF byte limits instead of treating them as zero', async () => {
    process.env.MEDICATION_HISTORY_BULK_EXPORT_MAX_TOTAL_PDF_BYTES = '0.5';
    integrationJobFindFirstMock.mockResolvedValue(null);

    const result = await runMedicationHistoryBulkExportJob('job_1');

    expect(result).toMatchObject({
      jobId: 'job_1',
      fileId: 'file_1',
      patientCount: 2,
    });
    expect(zipSyncMock).toHaveBeenCalledOnce();
    expect(storeGeneratedFileMock).toHaveBeenCalledOnce();
  });

  it('stores and notifies a safe failure message when the final export audit cannot be written', async () => {
    const rawFailure = 'audit unavailable patient=患者A token=secret s3://bucket/private.zip';
    integrationJobFindFirstMock.mockResolvedValue(null);
    auditLogCreateMock.mockRejectedValueOnce(new Error(rawFailure));

    await expect(runMedicationHistoryBulkExportJob('job_1')).rejects.toThrow(rawFailure);
    expect(deleteGeneratedFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'file_1',
        purpose: 'bulk-export',
      }),
    );
    expect(integrationJobUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'completed',
        }),
      }),
    );
    expect(integrationJobUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'failed',
          error_log: '薬歴 PDF ZIP の生成に失敗しました',
        }),
      }),
    );
    expect(notificationUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          event_type: 'medication_history_bulk_export_failed',
          message: '薬歴 PDF ZIP の生成に失敗しました',
        }),
      }),
    );
    expect(JSON.stringify(integrationJobUpdateManyMock.mock.calls)).not.toContain(rawFailure);
    expect(JSON.stringify(notificationUpsertMock.mock.calls)).not.toContain(rawFailure);
  });

  it('keeps a completed export completed when the ready notification fails', async () => {
    const rawFailure = 'notification unavailable patient=患者A token=secret';
    integrationJobFindFirstMock.mockResolvedValue(null);
    notificationUpsertMock.mockRejectedValueOnce(new Error(rawFailure));

    const result = await runMedicationHistoryBulkExportJob('job_1');

    expect(result).toMatchObject({
      jobId: 'job_1',
      fileId: 'file_1',
      patientCount: 2,
    });
    expect(deleteGeneratedFileMock).not.toHaveBeenCalled();
    expect(integrationJobUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'job_1',
          status: 'running',
          locked_at: expect.any(Date),
        }),
        data: expect.objectContaining({
          status: 'completed',
          locked_at: null,
        }),
      }),
    );
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'medication_history_bulk_export.ready_notification_failed',
        orgId: 'org_1',
        userId: 'user_1',
        targetId: 'job_1',
        jobType: 'medication-history-bulk-export',
        operation: 'notify_ready',
      }),
      expect.any(Error),
    );
    expect(JSON.stringify(loggerWarnMock.mock.calls[0]?.[0])).not.toContain(rawFailure);
  });

  it('refreshes the running job lock before expensive terminal phases', async () => {
    integrationJobFindFirstMock.mockResolvedValue(null);

    await runMedicationHistoryBulkExportJob('job_1');

    const heartbeatCalls = integrationJobUpdateManyMock.mock.calls.filter(([args]) => {
      const payload = args as {
        where?: { id?: string; status?: string; locked_at?: Date };
        data?: { locked_at?: Date; status?: string };
      };
      return (
        payload.where?.id === 'job_1' &&
        payload.where.status === 'running' &&
        payload.where.locked_at instanceof Date &&
        payload.data?.locked_at instanceof Date &&
        payload.data.status === undefined
      );
    });

    expect(heartbeatCalls.length).toBeGreaterThanOrEqual(3);
    const completionCall = integrationJobUpdateManyMock.mock.calls.find(([args]) => {
      const payload = args as { data?: { status?: string } };
      return payload.data?.status === 'completed';
    });
    expect(completionCall?.[0]).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          locked_at: heartbeatCalls.at(-1)?.[0].data.locked_at,
        }),
      }),
    );
  });

  it('does not overwrite a stale-recovered running job after the worker loses its lock', async () => {
    const rawCleanupFailure =
      'cleanup failed patient=患者A token=secret storageKey=bulk-exports/org_1/raw.zip';
    integrationJobFindFirstMock.mockResolvedValue(null);
    integrationJobUpdateManyMock
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    deleteGeneratedFileMock.mockRejectedValueOnce(new Error(rawCleanupFailure));

    const result = await runMedicationHistoryBulkExportJob('job_1');

    expect(result).toBeNull();
    expect(storeGeneratedFileMock).toHaveBeenCalledOnce();
    expect(deleteGeneratedFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'file_1',
        purpose: 'bulk-export',
      }),
    );
    expect(notificationUpsertMock).not.toHaveBeenCalled();
    expect(integrationJobUpdateManyMock).toHaveBeenNthCalledWith(
      5,
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'job_1',
          status: 'running',
          locked_at: expect.any(Date),
        }),
        data: expect.objectContaining({
          status: 'completed',
        }),
      }),
    );
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'medication_history_bulk_export.completion_skipped_lock_lost',
        orgId: 'org_1',
        targetId: 'job_1',
        jobType: 'medication-history-bulk-export',
        operation: 'complete',
      }),
    );
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'medication_history_bulk_export.cleanup_failed',
        orgId: 'org_1',
        entityType: 'file',
        entityId: 'file_1',
        targetId: 'job_1',
        jobType: 'medication-history-bulk-export',
        filePurpose: 'bulk-export',
        operation: 'cleanup',
      }),
      expect.any(Error),
    );
    expect(JSON.stringify(loggerWarnMock.mock.calls.map(([context]) => context))).not.toContain(
      rawCleanupFailure,
    );
  });

  it('preserves the original export failure while storing a safe message when the failure notification also fails', async () => {
    const rawFailure = 'storage unavailable patient=患者A token=secret s3://bucket/private.zip';
    const rawNotificationFailure = 'notification unavailable patient=患者B token=secret';
    integrationJobFindFirstMock.mockResolvedValue(null);
    storeGeneratedFileMock.mockRejectedValueOnce(new Error(rawFailure));
    notificationUpsertMock.mockRejectedValueOnce(new Error(rawNotificationFailure));

    await expect(runMedicationHistoryBulkExportJob('job_1')).rejects.toThrow(rawFailure);
    expect(deleteGeneratedFileMock).not.toHaveBeenCalled();
    expect(integrationJobUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'job_1',
          status: 'running',
          locked_at: expect.any(Date),
        }),
        data: expect.objectContaining({
          status: 'failed',
          error_log: '薬歴 PDF ZIP の生成に失敗しました',
          locked_at: null,
        }),
      }),
    );
    expect(notificationUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          message: '薬歴 PDF ZIP の生成に失敗しました',
        }),
      }),
    );
    expect(JSON.stringify(integrationJobUpdateManyMock.mock.calls)).not.toContain(rawFailure);
    expect(JSON.stringify(notificationUpsertMock.mock.calls)).not.toContain(rawFailure);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'medication_history_bulk_export.failure_notification_failed',
        orgId: 'org_1',
        userId: 'user_1',
        targetId: 'job_1',
        jobType: 'medication-history-bulk-export',
        operation: 'notify_failure',
      }),
      expect.any(Error),
    );
    expect(JSON.stringify(loggerWarnMock.mock.calls[0]?.[0])).not.toContain(rawNotificationFailure);
  });

  it('drains the pending export queue', async () => {
    integrationJobFindFirstMock
      .mockResolvedValueOnce({ id: 'job_1' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const result = await drainMedicationHistoryBulkExportQueue();

    expect(result).toMatchObject({
      processedCount: 2,
      errors: [],
    });
    expect(integrationJobFindFirstMock).toHaveBeenCalledTimes(3);
    expect(integrationJobUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          job_type: 'medication-history-bulk-export',
          status: 'running',
          locked_at: expect.objectContaining({
            lt: expect.any(Date),
          }),
        }),
        data: expect.objectContaining({
          status: 'failed',
          locked_at: null,
          retry_count: { increment: 1 },
        }),
      }),
    );
  });

  it('skips busy organizations during a global drain and continues with runnable jobs', async () => {
    integrationJobFindFirstMock
      .mockResolvedValueOnce({ id: 'job_busy' })
      .mockResolvedValueOnce({ id: 'running_same_org' })
      .mockResolvedValueOnce({ id: 'job_runnable' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    integrationJobFindUniqueMock
      .mockResolvedValueOnce({
        id: 'job_busy',
        org_id: 'org_busy',
        status: 'pending',
        job_type: 'medication-history-bulk-export',
        input: {
          version: 1,
          requestedBy: 'user_1',
          patientIds: ['patient_1', 'patient_2'],
        },
      })
      .mockResolvedValueOnce({
        id: 'job_runnable',
        org_id: 'org_runnable',
        status: 'pending',
        job_type: 'medication-history-bulk-export',
        input: {
          version: 1,
          requestedBy: 'user_1',
          patientIds: ['patient_1', 'patient_2'],
        },
      });

    const result = await drainMedicationHistoryBulkExportQueue();

    expect(result).toMatchObject({
      processedCount: 2,
      errors: [],
    });
    expect(storeGeneratedFileMock).toHaveBeenCalledOnce();
    expect(integrationJobFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { notIn: ['job_busy'] },
        }),
      }),
    );
  });

  it('continues draining after a terminal job failure', async () => {
    buildMedicationHistoryPdfMock
      .mockReset()
      .mockResolvedValueOnce({
        fileName: 'medications-patient_1.pdf',
        buffer: Buffer.from('%PDF-A'),
      })
      .mockResolvedValueOnce({
        fileName: 'medications-patient_2.pdf',
        buffer: Buffer.from('%PDF-B'),
      })
      .mockResolvedValueOnce({
        fileName: 'medications-patient_1.pdf',
        buffer: Buffer.from('%PDF-C'),
      })
      .mockResolvedValueOnce({
        fileName: 'medications-patient_2.pdf',
        buffer: Buffer.from('%PDF-D'),
      });
    integrationJobFindFirstMock
      .mockResolvedValueOnce({ id: 'job_failed' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'job_success' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    integrationJobFindUniqueMock
      .mockResolvedValueOnce({
        id: 'job_failed',
        org_id: 'org_1',
        status: 'pending',
        job_type: 'medication-history-bulk-export',
        input: {
          version: 1,
          requestedBy: 'user_1',
          patientIds: ['patient_1', 'patient_2'],
        },
      })
      .mockResolvedValueOnce({
        id: 'job_success',
        org_id: 'org_2',
        status: 'pending',
        job_type: 'medication-history-bulk-export',
        input: {
          version: 1,
          requestedBy: 'user_1',
          patientIds: ['patient_1', 'patient_2'],
        },
      });
    const rawFailure = 'storage unavailable patient=患者A token=secret s3://bucket/private.zip';
    storeGeneratedFileMock.mockRejectedValueOnce(new Error(rawFailure)).mockResolvedValueOnce({
      version: 1,
      id: 'file_2',
      orgId: 'org_2',
      purpose: 'bulk-export',
      storageKey: 'bulk-exports/org_2/job_success/file_2-medication-history.zip',
      originalName: 'medication-history.zip',
      mimeType: 'application/zip',
      sizeBytes: 32,
      status: 'uploaded',
      uploadedBy: 'user_1',
      jobId: 'job_success',
      createdAt: '2026-05-21T00:00:00.000Z',
      updatedAt: '2026-05-21T00:00:00.000Z',
      completedAt: '2026-05-21T00:00:00.000Z',
      downloadDisposition: 'attachment',
    });

    const result = await drainMedicationHistoryBulkExportQueue();

    expect(result).toMatchObject({
      processedCount: 2,
      errors: ['薬歴 PDF ZIP の生成に失敗しました'],
    });
    expect(JSON.stringify(result)).not.toContain(rawFailure);
    expect(storeGeneratedFileMock).toHaveBeenCalledTimes(2);
  });

  it('recovers stale running jobs but does not auto-retry failed jobs during drain', async () => {
    integrationJobFindFirstMock.mockResolvedValue(null);

    const result = await drainMedicationHistoryBulkExportQueue();

    expect(result).toMatchObject({
      processedCount: 0,
      errors: [],
    });
    expect(integrationJobUpdateManyMock).toHaveBeenCalledOnce();
    expect(integrationJobUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'running',
          locked_at: expect.objectContaining({ lt: expect.any(Date) }),
        }),
        data: expect.objectContaining({
          status: 'failed',
          locked_at: null,
        }),
      }),
    );
  });

  it('does not let stale running jobs count against the queue quota', async () => {
    await queueMedicationHistoryBulkExport({
      orgId: 'org_1',
      requestedBy: 'user_1',
      patientIds: ['patient_1', 'patient_2'],
      accessContext: {
        userId: 'user_1',
        role: 'admin',
      },
    });

    expect(integrationJobUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          status: 'running',
          locked_at: expect.objectContaining({ lt: expect.any(Date) }),
        }),
        data: expect.objectContaining({
          status: 'failed',
        }),
      }),
    );
    expect(integrationJobUpdateManyMock.mock.invocationCallOrder[0]).toBeLessThan(
      integrationJobCountMock.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
    expect(integrationJobCreateMock).toHaveBeenCalledOnce();
  });
});
