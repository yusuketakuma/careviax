import { Prisma } from '@prisma/client';
import { zipSync } from 'fflate';
import { withOrgContext } from '@/lib/db/rls';
import type { RequestAuthContext } from '@/lib/auth/request-context';
import { hasPermission } from '@/lib/auth/permissions';
import { buildFileDownloadHref } from '@/lib/files/navigation';
import { mapWithConcurrency } from '@/lib/utils/concurrency';
import { logger } from '@/lib/utils/logger';
import { buildMedicationHistoryPdf } from '@/server/services/pdf-documents';
import { PdfNotFoundError } from '@/server/services/pdf-errors';
import { deleteGeneratedFile, storeGeneratedFile } from '@/server/services/file-storage';
import { recordDataExportAudit } from '@/server/services/export-audit';
import {
  BulkExportLockLostError,
  MAX_PATIENTS_PER_EXPORT,
  MedicationHistoryBulkExportError,
  assertBulkExportTotalPdfBytes,
  buildInvalidTerminalBulkExportInput,
  buildPatientSelectionHash,
  buildPersistedRequestTrace,
  buildTerminalBulkExportInput,
  buildTimeoutTerminalBulkExportInput,
  bulkExportInputSchema,
  bulkExportPatientIdsSchema,
  formatTimestampForFileName,
  getSafeBulkExportFailureMessage,
  readPersistedRequestTrace,
  summarizeBulkExportRenderErrors,
  validateRequestTracePair,
  withOrgSerializableRetry,
  type BulkExportRenderError,
  type MedicationHistoryBulkExportResult,
  type PdfRenderResult,
  type QueueMedicationHistoryBulkExportArgs,
} from './pdf-bulk-export-contract';

export { MedicationHistoryBulkExportError } from './pdf-bulk-export-contract';
import {
  assertBulkExportPatientAccess,
  assertPatientsExist,
  getRequesterAccessContext,
  type BulkExportJobRecoveryDb,
} from './pdf-bulk-export-access';

const BULK_EXPORT_JOB_TYPE = 'medication-history-bulk-export';
const MAX_QUEUED_JOBS_PER_ORG = 3;
const PDF_RENDER_CONCURRENCY = 4;
const MAX_REPORTED_ERRORS = 20;
const MAX_DRAIN_ITERATIONS = 50;
const RUNNING_JOB_LOCK_TIMEOUT_MS = 30 * 60_000;
const BULK_EXPORT_HEARTBEAT_INTERVAL_MS = 5 * 60_000;

async function recoverStaleBulkExportRunningJobs(args: {
  db: BulkExportJobRecoveryDb;
  orgId?: string;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  const staleBefore = new Date(now.getTime() - RUNNING_JOB_LOCK_TIMEOUT_MS);

  return args.db.integrationJob.updateMany({
    where: {
      job_type: BULK_EXPORT_JOB_TYPE,
      status: 'running',
      locked_at: { lt: staleBefore },
      ...(args.orgId ? { org_id: args.orgId } : {}),
    },
    data: {
      status: 'failed',
      error_log: '薬歴 PDF 一括出力ジョブがタイムアウトしました',
      input: buildTimeoutTerminalBulkExportInput(),
      completed_at: now,
      locked_at: null,
      retry_count: { increment: 1 },
    },
  });
}

async function notifyBulkExportReady(args: {
  db: Pick<Prisma.TransactionClient, 'notification'>;
  orgId: string;
  userId: string;
  fileId: string;
  patientCount: number;
  failedCount: number;
  jobId: string;
}) {
  const message =
    args.failedCount > 0
      ? `${args.patientCount}件の薬歴PDFを ZIP にまとめました。${args.failedCount}件は生成できませんでした。`
      : `${args.patientCount}件の薬歴PDFを ZIP で出力しました。`;
  const downloadHref = buildFileDownloadHref(args.fileId);

  await args.db.notification.upsert({
    where: {
      org_id_user_id_dedupe_key: {
        org_id: args.orgId,
        user_id: args.userId,
        dedupe_key: `medication-history-bulk-export:${args.jobId}`,
      },
    },
    create: {
      org_id: args.orgId,
      user_id: args.userId,
      event_type: 'medication_history_bulk_export_ready',
      type: 'business',
      title: '薬歴 PDF 一括出力の準備が完了しました',
      message,
      link: downloadHref,
      metadata: {
        job_id: args.jobId,
        file_id: args.fileId,
        patient_count: args.patientCount,
        failed_count: args.failedCount,
      } satisfies Prisma.InputJsonValue,
      dedupe_key: `medication-history-bulk-export:${args.jobId}`,
    },
    update: {
      is_read: false,
      read_at: null,
      message,
      link: downloadHref,
      metadata: {
        job_id: args.jobId,
        file_id: args.fileId,
        patient_count: args.patientCount,
        failed_count: args.failedCount,
      } satisfies Prisma.InputJsonValue,
    },
  });
}

async function notifyBulkExportFailed(args: {
  db: Pick<Prisma.TransactionClient, 'notification'>;
  orgId: string;
  userId: string;
  jobId: string;
  message: string;
}) {
  await args.db.notification.upsert({
    where: {
      org_id_user_id_dedupe_key: {
        org_id: args.orgId,
        user_id: args.userId,
        dedupe_key: `medication-history-bulk-export-failed:${args.jobId}`,
      },
    },
    create: {
      org_id: args.orgId,
      user_id: args.userId,
      event_type: 'medication_history_bulk_export_failed',
      type: 'urgent',
      title: '薬歴 PDF 一括出力に失敗しました',
      message: args.message,
      link: '/admin/jobs',
      metadata: {
        job_id: args.jobId,
      } satisfies Prisma.InputJsonValue,
      dedupe_key: `medication-history-bulk-export-failed:${args.jobId}`,
    },
    update: {
      is_read: false,
      read_at: null,
      message: args.message,
      link: '/admin/jobs',
    },
  });
}

async function cleanupStoredBulkExportFile(args: {
  jobId: string;
  file: Awaited<ReturnType<typeof storeGeneratedFile>>;
}) {
  try {
    await deleteGeneratedFile(args.file);
  } catch (cleanupError) {
    logger.warn(
      {
        event: 'medication_history_bulk_export.cleanup_failed',
        orgId: args.file.orgId,
        entityType: 'file',
        entityId: args.file.id,
        targetId: args.jobId,
        jobType: BULK_EXPORT_JOB_TYPE,
        filePurpose: args.file.purpose,
        operation: 'cleanup',
      },
      cleanupError,
    );
  }
}

async function refreshBulkExportJobLock(args: {
  orgId: string;
  requestContext: RequestAuthContext;
  jobId: string;
  lockedAt: Date;
}) {
  const nextLockedAt = new Date();
  const refreshed = await withOrgContext(
    args.orgId,
    (tx) =>
      tx.integrationJob.updateMany({
        where: {
          id: args.jobId,
          org_id: args.orgId,
          status: 'running',
          locked_at: args.lockedAt,
        },
        data: {
          locked_at: nextLockedAt,
        },
      }),
    { requestContext: args.requestContext },
  );

  return refreshed.count > 0 ? nextLockedAt : null;
}

async function buildMedicationHistoryArchive(
  orgId: string,
  patientIds: string[],
  accessContext: VisitScheduleAccessContext,
  requestContext: RequestAuthContext,
  onProgress?: () => Promise<void>,
): Promise<{ zipEntries: Record<string, Uint8Array>; errors: BulkExportRenderError[] }> {
  const pdfs = await mapWithConcurrency(
    patientIds,
    PDF_RENDER_CONCURRENCY,
    async (patientId): Promise<PdfRenderResult> => {
      try {
        const pdf = await buildMedicationHistoryPdf(orgId, patientId, accessContext, {
          runDb: (work) => withOrgContext(orgId, work, { requestContext }),
        });
        return {
          patientId,
          fileName: pdf.fileName,
          buffer: pdf.buffer,
        };
      } catch (error) {
        // PdfNotFoundError carries a constant safe message (see pdf-errors.ts).
        // Other errors may carry adapter/Prisma details; sanitize before exposing.
        const message =
          error instanceof PdfNotFoundError ? error.message : 'PDF 生成に失敗しました';
        return {
          patientId,
          error: message,
          errorCode: error instanceof PdfNotFoundError ? 'pdf_not_found' : 'render_failed',
        };
      } finally {
        await onProgress?.();
      }
    },
  );

  const zipEntries: Record<string, Uint8Array> = {};
  const errors: BulkExportRenderError[] = [];

  for (const pdf of pdfs) {
    if ('error' in pdf) {
      errors.push({ code: pdf.errorCode, message: pdf.error });
      continue;
    }
    zipEntries[pdf.fileName] = new Uint8Array(pdf.buffer);
  }

  return { zipEntries, errors };
}

export async function queueMedicationHistoryBulkExport(args: QueueMedicationHistoryBulkExportArgs) {
  if (
    args.requestedBy !== args.accessContext.userId ||
    !hasPermission(args.accessContext.role, 'canVisit')
  ) {
    throw new MedicationHistoryBulkExportError(
      'AUTHORIZATION_ERROR',
      '薬歴 PDF 一括出力の実行権限がありません',
      403,
    );
  }

  const parsedPatientIds = bulkExportPatientIdsSchema.safeParse(args.patientIds);
  if (!parsedPatientIds.success) {
    throw new MedicationHistoryBulkExportError(
      'VALIDATION_ERROR',
      '患者IDを1件以上指定してください',
      400,
    );
  }

  const normalizedPatientIds = parsedPatientIds.data;
  const requestTrace = validateRequestTracePair(
    args.requestTrace?.requestId,
    args.requestTrace?.correlationId,
  );
  if (normalizedPatientIds.length > MAX_PATIENTS_PER_EXPORT) {
    throw new MedicationHistoryBulkExportError(
      'VALIDATION_ERROR',
      `一括出力は ${MAX_PATIENTS_PER_EXPORT} 件までです`,
      400,
    );
  }

  const requestContext: RequestAuthContext = {
    userId: args.requestedBy,
    orgId: args.orgId,
    role: args.accessContext.role,
    ...(args.auditContext?.ipAddress ? { ipAddress: args.auditContext.ipAddress } : {}),
    ...(args.auditContext?.userAgent ? { userAgent: args.auditContext.userAgent } : {}),
    ...(requestTrace
      ? { requestId: requestTrace.requestId, correlationId: requestTrace.correlationId }
      : {}),
  };

  return withOrgSerializableRetry({
    orgId: args.orgId,
    requestContext,
    work: async (tx) => {
      await recoverStaleBulkExportRunningJobs({
        db: tx,
        orgId: args.orgId,
      });

      const queuedCount = await tx.integrationJob.count({
        where: {
          org_id: args.orgId,
          job_type: BULK_EXPORT_JOB_TYPE,
          status: {
            in: ['pending', 'running'],
          },
        },
      });

      if (queuedCount >= MAX_QUEUED_JOBS_PER_ORG) {
        throw new MedicationHistoryBulkExportError(
          'WORKFLOW_CONFLICT',
          '同時に処理できる一括出力ジョブの上限に達しています。完了後に再実行してください。',
          409,
        );
      }

      await assertPatientsExist({
        db: tx,
        orgId: args.orgId,
        patientIds: normalizedPatientIds,
      });
      await assertBulkExportPatientAccess({
        db: tx,
        orgId: args.orgId,
        patientIds: normalizedPatientIds,
        accessContext: args.accessContext,
      });

      const job = await tx.integrationJob.create({
        data: {
          org_id: args.orgId,
          job_type: BULK_EXPORT_JOB_TYPE,
          status: 'pending',
          max_retries: 0,
          retry_count: 0,
          run_at: new Date(),
          input: {
            version: 1,
            requestedBy: args.requestedBy,
            patientIds: normalizedPatientIds,
            ...buildPersistedRequestTrace(requestTrace),
          } satisfies Prisma.InputJsonValue,
        },
        select: {
          id: true,
        },
      });

      await recordDataExportAudit(tx, {
        orgId: args.orgId,
        actorId: args.requestedBy,
        targetType: 'medication_history',
        targetId: job.id,
        format: 'pdf',
        recordCount: normalizedPatientIds.length,
        metadata: {
          job_id: job.id,
          status: 'queued',
          patient_count: normalizedPatientIds.length,
          requested_count: normalizedPatientIds.length,
          patient_selection_hash: buildPatientSelectionHash(args.orgId, normalizedPatientIds),
        },
        ipAddress: args.auditContext?.ipAddress,
        userAgent: args.auditContext?.userAgent,
        requestId: requestTrace?.requestId,
        correlationId: requestTrace?.correlationId,
      });

      return {
        jobId: job.id,
        queuePosition: queuedCount + 1,
        patientCount: normalizedPatientIds.length,
        startedImmediately: queuedCount === 0,
      };
    },
  });
}

export async function runMedicationHistoryBulkExportJob(
  jobId: string,
  orgId: string,
): Promise<MedicationHistoryBulkExportResult | null> {
  const job = await withOrgSerializableRetry({
    orgId,
    work: async (tx) => {
      const candidate = await tx.integrationJob.findUnique({
        where: { id: jobId },
        select: {
          id: true,
          org_id: true,
          input: true,
          status: true,
          job_type: true,
        },
      });

      if (candidate?.org_id !== orgId || candidate.job_type !== BULK_EXPORT_JOB_TYPE) {
        throw new MedicationHistoryBulkExportError(
          'WORKFLOW_NOT_FOUND',
          '一括出力ジョブが見つかりません',
          404,
        );
      }

      if (candidate.status !== 'pending') {
        return null;
      }

      const runningSibling = await tx.integrationJob.findFirst({
        where: {
          org_id: orgId,
          job_type: BULK_EXPORT_JOB_TYPE,
          status: 'running',
          id: { not: jobId },
          locked_at: { gte: new Date(Date.now() - RUNNING_JOB_LOCK_TIMEOUT_MS) },
        },
        select: {
          id: true,
        },
      });

      if (runningSibling) {
        return null;
      }

      const lockedAt = new Date();
      const started = await tx.integrationJob.updateMany({
        where: {
          id: jobId,
          org_id: orgId,
          job_type: BULK_EXPORT_JOB_TYPE,
          status: 'pending',
        },
        data: {
          status: 'running',
          started_at: lockedAt,
          locked_at: lockedAt,
          completed_at: null,
          error_log: null,
        },
      });

      if (started.count === 0) {
        return null;
      }

      return {
        id: candidate.id,
        org_id: orgId,
        input: candidate.input,
        lockedAt,
      };
    },
  });

  if (!job) {
    return null;
  }

  const requestTrace = readPersistedRequestTrace(job.input);
  const parsedInput = bulkExportInputSchema.safeParse(job.input);
  if (!parsedInput.success) {
    const message = '一括出力ジョブの入力が不正です';
    await withOrgContext(job.org_id, (tx) =>
      tx.integrationJob.updateMany({
        where: {
          id: job.id,
          org_id: job.org_id,
          status: 'running',
          locked_at: job.lockedAt,
        },
        data: {
          status: 'failed',
          error_log: message,
          input: buildInvalidTerminalBulkExportInput(job.input, requestTrace),
          completed_at: new Date(),
          locked_at: null,
          retry_count: { increment: 1 },
        },
      }),
    );
    throw new MedicationHistoryBulkExportError('VALIDATION_ERROR', message, 400);
  }

  let storedFileForCleanup: Awaited<ReturnType<typeof storeGeneratedFile>> | null = null;
  let currentLockAt = job.lockedAt;
  let lastHeartbeatAt = job.lockedAt;
  let requestContext: RequestAuthContext | null = null;

  const heartbeat = async (opts?: { force?: boolean }) => {
    if (
      !opts?.force &&
      Date.now() - lastHeartbeatAt.getTime() < BULK_EXPORT_HEARTBEAT_INTERVAL_MS
    ) {
      return;
    }

    if (!requestContext) {
      throw new Error('bulk export requester context is not initialized');
    }

    const refreshedLockAt = await refreshBulkExportJobLock({
      orgId: job.org_id,
      requestContext,
      jobId: job.id,
      lockedAt: currentLockAt,
    });
    if (!refreshedLockAt) {
      throw new BulkExportLockLostError(job.id);
    }

    currentLockAt = refreshedLockAt;
    lastHeartbeatAt = refreshedLockAt;
  };

  try {
    const accessContext = await withOrgContext(job.org_id, (tx) =>
      getRequesterAccessContext({
        db: tx,
        orgId: job.org_id,
        requestedBy: parsedInput.data.requestedBy,
      }),
    );
    requestContext = {
      userId: accessContext.userId,
      orgId: job.org_id,
      role: accessContext.role,
      ...(requestTrace
        ? { requestId: requestTrace.requestId, correlationId: requestTrace.correlationId }
        : {}),
    };
    await withOrgContext(
      job.org_id,
      async (tx) => {
        await assertPatientsExist({
          db: tx,
          orgId: job.org_id,
          patientIds: parsedInput.data.patientIds,
        });
        await assertBulkExportPatientAccess({
          db: tx,
          orgId: job.org_id,
          patientIds: parsedInput.data.patientIds,
          accessContext,
        });
      },
      { requestContext },
    );

    const { zipEntries, errors } = await buildMedicationHistoryArchive(
      job.org_id,
      parsedInput.data.patientIds,
      accessContext,
      requestContext,
      heartbeat,
    );
    const patientCount = Object.keys(zipEntries).length;
    const failureCodes = summarizeBulkExportRenderErrors(errors);

    if (patientCount === 0) {
      throw new MedicationHistoryBulkExportError(
        'WORKFLOW_CONFLICT',
        '薬歴 PDF の生成に失敗しました',
        409,
      );
    }
    await heartbeat({ force: true });
    assertBulkExportTotalPdfBytes(zipEntries);

    const zipBuffer = Buffer.from(zipSync(zipEntries, { level: 6 }));
    await heartbeat({ force: true });
    const fileName = `medication-history-bulk-${formatTimestampForFileName()}.zip`;
    const storedFile = await storeGeneratedFile({
      orgId: job.org_id,
      purpose: 'bulk-export',
      fileName,
      mimeType: 'application/zip',
      buffer: zipBuffer,
      uploadedBy: parsedInput.data.requestedBy,
      jobId: job.id,
      downloadDisposition: 'attachment',
    });
    storedFileForCleanup = storedFile;
    await heartbeat({ force: true });

    const result = {
      jobId: job.id,
      fileId: storedFile.id,
      patientCount,
      requestedCount: parsedInput.data.patientIds.length,
      failedCount: errors.length,
      failureCodes,
    };
    const terminalInput = buildTerminalBulkExportInput({
      orgId: job.org_id,
      requestedBy: parsedInput.data.requestedBy,
      patientIds: parsedInput.data.patientIds,
      requestTrace,
    });

    const completed = await withOrgContext(
      job.org_id,
      async (tx) => {
        const updated = await tx.integrationJob.updateMany({
          where: {
            id: job.id,
            org_id: job.org_id,
            status: 'running',
            locked_at: currentLockAt,
          },
          data: {
            status: 'completed',
            input: terminalInput,
            output: result satisfies Prisma.InputJsonValue,
            completed_at: new Date(),
            locked_at: null,
          },
        });

        if (updated.count === 0) {
          return updated;
        }

        await recordDataExportAudit(tx, {
          orgId: job.org_id,
          actorId: parsedInput.data.requestedBy,
          targetType: 'medication_history',
          targetId: job.id,
          format: 'zip',
          recordCount: patientCount,
          metadata: {
            job_id: job.id,
            file_id: storedFile.id,
            requested_count: parsedInput.data.patientIds.length,
            success_count: patientCount,
            failed_count: errors.length,
            failure_codes: failureCodes,
            patient_selection_hash: terminalInput.patient_selection_hash,
          },
          requestId: requestTrace?.requestId,
          correlationId: requestTrace?.correlationId,
        });

        return updated;
      },
      { requestContext },
    );

    if (completed.count === 0) {
      logger.warn({
        event: 'medication_history_bulk_export.completion_skipped_lock_lost',
        orgId: job.org_id,
        targetId: job.id,
        jobType: BULK_EXPORT_JOB_TYPE,
        operation: 'complete',
      });
      await cleanupStoredBulkExportFile({
        jobId: job.id,
        file: storedFile,
      });
      return null;
    }

    storedFileForCleanup = null;

    try {
      await withOrgContext(
        job.org_id,
        (tx) =>
          notifyBulkExportReady({
            db: tx,
            orgId: job.org_id,
            userId: parsedInput.data.requestedBy,
            fileId: storedFile.id,
            patientCount,
            failedCount: errors.length,
            jobId: job.id,
          }),
        { requestContext },
      );
    } catch (notificationError) {
      logger.warn(
        {
          event: 'medication_history_bulk_export.ready_notification_failed',
          orgId: job.org_id,
          userId: parsedInput.data.requestedBy,
          targetId: job.id,
          jobType: BULK_EXPORT_JOB_TYPE,
          operation: 'notify_ready',
        },
        notificationError,
      );
    }

    return {
      jobId: job.id,
      fileId: storedFile.id,
      patientCount,
      errors: errors.slice(0, MAX_REPORTED_ERRORS).map((error) => error.message),
    };
  } catch (cause) {
    if (cause instanceof BulkExportLockLostError) {
      if (storedFileForCleanup) {
        await cleanupStoredBulkExportFile({
          jobId: job.id,
          file: storedFileForCleanup,
        });
      }
      logger.warn({
        event: 'medication_history_bulk_export.aborted_lock_lost',
        orgId: job.org_id,
        targetId: job.id,
        jobType: BULK_EXPORT_JOB_TYPE,
        operation: 'run',
      });
      return null;
    }

    const message = getSafeBulkExportFailureMessage(cause);

    if (storedFileForCleanup) {
      await cleanupStoredBulkExportFile({
        jobId: job.id,
        file: storedFileForCleanup,
      });
      storedFileForCleanup = null;
    }

    const failed = await withOrgContext(
      job.org_id,
      (tx) =>
        tx.integrationJob.updateMany({
          where: {
            id: job.id,
            org_id: job.org_id,
            status: 'running',
            locked_at: currentLockAt,
          },
          data: {
            status: 'failed',
            error_log: message,
            input: buildTerminalBulkExportInput({
              orgId: job.org_id,
              requestedBy: parsedInput.data.requestedBy,
              patientIds: parsedInput.data.patientIds,
              requestTrace,
            }),
            completed_at: new Date(),
            locked_at: null,
          },
        }),
      requestContext ? { requestContext } : undefined,
    );

    if (failed.count === 0) {
      logger.warn({
        event: 'medication_history_bulk_export.failure_skipped_lock_lost',
        orgId: job.org_id,
        targetId: job.id,
        jobType: BULK_EXPORT_JOB_TYPE,
        operation: 'fail',
      });
      return null;
    }

    try {
      await withOrgContext(
        job.org_id,
        (tx) =>
          notifyBulkExportFailed({
            db: tx,
            orgId: job.org_id,
            userId: parsedInput.data.requestedBy,
            jobId: job.id,
            message,
          }),
        requestContext ? { requestContext } : undefined,
      );
    } catch (notificationError) {
      logger.warn(
        {
          event: 'medication_history_bulk_export.failure_notification_failed',
          orgId: job.org_id,
          userId: parsedInput.data.requestedBy,
          targetId: job.id,
          jobType: BULK_EXPORT_JOB_TYPE,
          operation: 'notify_failure',
        },
        notificationError,
      );
    }

    throw cause;
  }
}

export async function drainMedicationHistoryBulkExportQueue(args: { orgId: string }) {
  let processedCount = 0;
  const errors: string[] = [];
  const skippedJobIds = new Set<string>();

  for (let iteration = 0; iteration < MAX_DRAIN_ITERATIONS; iteration += 1) {
    const nextJob = await withOrgContext(args.orgId, async (db) => {
      await recoverStaleBulkExportRunningJobs({
        db,
        orgId: args.orgId,
      });

      return db.integrationJob.findFirst({
        where: {
          job_type: BULK_EXPORT_JOB_TYPE,
          status: 'pending',
          ...(skippedJobIds.size > 0 ? { id: { notIn: Array.from(skippedJobIds) } } : {}),
          org_id: args.orgId,
        },
        orderBy: {
          created_at: 'asc',
        },
        select: {
          id: true,
          org_id: true,
        },
      });
    });

    if (!nextJob) break;
    if (!nextJob.org_id) {
      errors.push('一括出力ジョブの組織情報が不正です');
      skippedJobIds.add(nextJob.id);
      continue;
    }

    try {
      const result = await runMedicationHistoryBulkExportJob(nextJob.id, nextJob.org_id);
      if (!result) {
        skippedJobIds.add(nextJob.id);
        continue;
      }
      processedCount += result.patientCount;
    } catch (cause) {
      errors.push(getSafeBulkExportFailureMessage(cause));
      skippedJobIds.add(nextJob.id);
    }
  }

  return { processedCount, errors };
}
