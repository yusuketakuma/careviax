import { Prisma } from '@prisma/client';
import { zipSync } from 'fflate';
import { z } from 'zod';
import { prisma } from '@/lib/db/client';
import { hasPermission } from '@/lib/auth/permissions';
import {
  buildVisitScheduleAssignmentWhere,
  canAccessVisitScheduleAssignment,
  canBypassVisitScheduleAssignmentAccess,
  type VisitScheduleAccessContext,
} from '@/lib/auth/visit-schedule-access';
import { buildMedicationHistoryPdf } from '@/server/services/pdf-documents';
import { storeGeneratedFile } from '@/server/services/file-storage';

const BULK_EXPORT_JOB_TYPE = 'medication-history-bulk-export';
const MAX_PATIENTS_PER_EXPORT = 500;
const MAX_QUEUED_JOBS_PER_ORG = 3;
const PDF_RENDER_CONCURRENCY = 4;
const MAX_REPORTED_ERRORS = 20;
const SERIALIZABLE_RETRY_LIMIT = 3;

const bulkExportInputSchema = z.object({
  version: z.literal(1).default(1),
  requestedBy: z.string().min(1),
  patientIds: z.array(z.string().min(1)).min(1).max(MAX_PATIENTS_PER_EXPORT),
});

type QueueMedicationHistoryBulkExportArgs = {
  orgId: string;
  requestedBy: string;
  patientIds: string[];
  accessContext: VisitScheduleAccessContext;
};

type MedicationHistoryBulkExportResult = {
  jobId: string;
  fileId: string;
  patientCount: number;
  errors?: string[];
};

type PdfRenderResult =
  | {
      patientId: string;
      fileName: string;
      buffer: Buffer;
    }
  | {
      patientId: string;
      error: string;
    };

export class MedicationHistoryBulkExportError extends Error {
  constructor(
    readonly code:
      | 'WORKFLOW_CONFLICT'
      | 'VALIDATION_ERROR'
      | 'WORKFLOW_NOT_FOUND'
      | 'AUTHORIZATION_ERROR',
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'MedicationHistoryBulkExportError';
  }
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function formatTimestampForFileName(date = new Date()) {
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    '-',
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
  ];

  return parts.join('');
}

async function withSerializableRetry<TValue>(
  work: (tx: Prisma.TransactionClient) => Promise<TValue>,
): Promise<TValue> {
  for (let attempt = 0; attempt < SERIALIZABLE_RETRY_LIMIT; attempt += 1) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (cause) {
      const isRetryableConflict =
        cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2034';

      if (!isRetryableConflict || attempt === SERIALIZABLE_RETRY_LIMIT - 1) {
        throw cause;
      }
    }
  }

  throw new Error('bulk export transaction could not be completed');
}

async function mapWithConcurrency<TValue, TResult>(
  values: TValue[],
  concurrency: number,
  mapper: (value: TValue, index: number) => Promise<TResult>,
) {
  const results = new Array<TResult>(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(values[currentIndex]!, currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));

  return results;
}

type BulkExportAccessDb = Pick<Prisma.TransactionClient, 'careCase' | 'patient' | 'visitSchedule'>;

async function assertPatientsExist(args: {
  db: BulkExportAccessDb;
  orgId: string;
  patientIds: string[];
}) {
  const existingPatientCount = await args.db.patient.count({
    where: {
      org_id: args.orgId,
      id: {
        in: args.patientIds,
      },
    },
  });

  if (existingPatientCount !== args.patientIds.length) {
    throw new MedicationHistoryBulkExportError(
      'WORKFLOW_NOT_FOUND',
      '指定された患者の一部が見つかりません',
      404,
    );
  }
}

async function assertBulkExportPatientAccess(args: {
  db: BulkExportAccessDb;
  orgId: string;
  patientIds: string[];
  accessContext: VisitScheduleAccessContext;
}) {
  if (canBypassVisitScheduleAssignmentAccess(args.accessContext)) {
    return;
  }

  const scheduleAssignmentWhere = buildVisitScheduleAssignmentWhere(args.accessContext);
  const accessiblePatientIds = new Set<string>();

  if (scheduleAssignmentWhere) {
    const accessibleSchedules = await args.db.visitSchedule.findMany({
      where: {
        org_id: args.orgId,
        case_: {
          patient_id: {
            in: args.patientIds,
          },
        },
        AND: [scheduleAssignmentWhere],
      },
      select: {
        case_: {
          select: {
            patient_id: true,
          },
        },
      },
    });

    for (const schedule of accessibleSchedules) {
      accessiblePatientIds.add(schedule.case_.patient_id);
    }
  }

  const unresolvedPatientIds = args.patientIds.filter(
    (patientId) => !accessiblePatientIds.has(patientId),
  );

  if (unresolvedPatientIds.length > 0) {
    const accessibleCases = await args.db.careCase.findMany({
      where: {
        org_id: args.orgId,
        patient_id: {
          in: unresolvedPatientIds,
        },
        OR: [
          { primary_pharmacist_id: args.accessContext.userId },
          { backup_pharmacist_id: args.accessContext.userId },
        ],
      },
      select: {
        patient_id: true,
        primary_pharmacist_id: true,
        backup_pharmacist_id: true,
      },
    });

    for (const careCase of accessibleCases) {
      if (
        canAccessVisitScheduleAssignment(args.accessContext, {
          pharmacist_id: null,
          case_: careCase,
        })
      ) {
        accessiblePatientIds.add(careCase.patient_id);
      }
    }
  }

  const forbiddenPatientIds = args.patientIds.filter(
    (patientId) => !accessiblePatientIds.has(patientId),
  );

  if (forbiddenPatientIds.length > 0) {
    throw new MedicationHistoryBulkExportError(
      'AUTHORIZATION_ERROR',
      '一括出力対象にアクセス権限のない患者が含まれています',
      403,
    );
  }
}

async function getRequesterAccessContext(args: {
  orgId: string;
  requestedBy: string;
}): Promise<VisitScheduleAccessContext> {
  const membership = await prisma.membership.findFirst({
    where: {
      org_id: args.orgId,
      user_id: args.requestedBy,
      is_active: true,
    },
    select: {
      role: true,
    },
  });

  if (!membership || !hasPermission(membership.role, 'canVisit')) {
    throw new MedicationHistoryBulkExportError(
      'AUTHORIZATION_ERROR',
      '薬歴 PDF 一括出力の実行権限がありません',
      403,
    );
  }

  return {
    userId: args.requestedBy,
    role: membership.role,
  };
}

async function notifyBulkExportReady(args: {
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

  await prisma.notification.upsert({
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
      link: `/api/files/${args.fileId}/download`,
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
      link: `/api/files/${args.fileId}/download`,
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
  orgId: string;
  userId: string;
  jobId: string;
  message: string;
}) {
  await prisma.notification.upsert({
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

async function buildMedicationHistoryArchive(
  orgId: string,
  patientIds: string[],
): Promise<{ zipEntries: Record<string, Uint8Array>; errors: string[] }> {
  const pdfs = await mapWithConcurrency(
    patientIds,
    PDF_RENDER_CONCURRENCY,
    async (patientId): Promise<PdfRenderResult> => {
      try {
        const pdf = await buildMedicationHistoryPdf(orgId, patientId);
        return {
          patientId,
          fileName: pdf.fileName,
          buffer: pdf.buffer,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          patientId,
          error: message,
        };
      }
    },
  );

  const zipEntries: Record<string, Uint8Array> = {};
  const errors: string[] = [];

  for (const pdf of pdfs) {
    if ('error' in pdf) {
      errors.push(`${pdf.patientId}: ${pdf.error}`);
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

  const normalizedPatientIds = uniqueStrings(args.patientIds);
  if (normalizedPatientIds.length === 0) {
    throw new MedicationHistoryBulkExportError(
      'VALIDATION_ERROR',
      '患者IDを1件以上指定してください',
      400,
    );
  }

  if (normalizedPatientIds.length > MAX_PATIENTS_PER_EXPORT) {
    throw new MedicationHistoryBulkExportError(
      'VALIDATION_ERROR',
      `一括出力は ${MAX_PATIENTS_PER_EXPORT} 件までです`,
      400,
    );
  }

  return withSerializableRetry(async (tx) => {
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
        } satisfies Prisma.InputJsonValue,
      },
      select: {
        id: true,
      },
    });

    return {
      jobId: job.id,
      queuePosition: queuedCount + 1,
      patientCount: normalizedPatientIds.length,
      startedImmediately: queuedCount === 0,
    };
  });
}

export async function runMedicationHistoryBulkExportJob(
  jobId: string,
): Promise<MedicationHistoryBulkExportResult | null> {
  const job = await withSerializableRetry(async (tx) => {
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

    if (!candidate?.org_id || candidate.job_type !== BULK_EXPORT_JOB_TYPE) {
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
        org_id: candidate.org_id,
        job_type: BULK_EXPORT_JOB_TYPE,
        status: 'running',
        id: { not: jobId },
      },
      select: {
        id: true,
      },
    });

    if (runningSibling) {
      return null;
    }

    const started = await tx.integrationJob.updateMany({
      where: {
        id: jobId,
        org_id: candidate.org_id,
        job_type: BULK_EXPORT_JOB_TYPE,
        status: 'pending',
      },
      data: {
        status: 'running',
        started_at: new Date(),
        locked_at: new Date(),
        completed_at: null,
        error_log: null,
      },
    });

    if (started.count === 0) {
      return null;
    }

    return {
      id: candidate.id,
      org_id: candidate.org_id,
      input: candidate.input,
    };
  });

  if (!job) {
    return null;
  }

  const parsedInput = bulkExportInputSchema.safeParse(job.input);
  if (!parsedInput.success) {
    const message = '一括出力ジョブの入力が不正です';
    await prisma.integrationJob.update({
      where: { id: job.id },
      data: {
        status: 'failed',
        error_log: message,
        completed_at: new Date(),
        locked_at: null,
        retry_count: { increment: 1 },
      },
    });
    throw new MedicationHistoryBulkExportError('VALIDATION_ERROR', message, 400);
  }

  try {
    const accessContext = await getRequesterAccessContext({
      orgId: job.org_id,
      requestedBy: parsedInput.data.requestedBy,
    });
    await assertPatientsExist({
      db: prisma,
      orgId: job.org_id,
      patientIds: parsedInput.data.patientIds,
    });
    await assertBulkExportPatientAccess({
      db: prisma,
      orgId: job.org_id,
      patientIds: parsedInput.data.patientIds,
      accessContext,
    });

    const { zipEntries, errors } = await buildMedicationHistoryArchive(
      job.org_id,
      parsedInput.data.patientIds,
    );
    const patientCount = Object.keys(zipEntries).length;

    if (patientCount === 0) {
      throw new MedicationHistoryBulkExportError(
        'WORKFLOW_CONFLICT',
        '薬歴 PDF の生成に失敗しました',
        409,
      );
    }

    const zipBuffer = Buffer.from(zipSync(zipEntries, { level: 6 }));
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

    const result = {
      jobId: job.id,
      fileId: storedFile.id,
      patientCount,
      requestedCount: parsedInput.data.patientIds.length,
      failedCount: errors.length,
      errors: errors.slice(0, MAX_REPORTED_ERRORS),
    };

    await prisma.integrationJob.update({
      where: { id: job.id },
      data: {
        status: 'completed',
        output: result satisfies Prisma.InputJsonValue,
        completed_at: new Date(),
        locked_at: null,
      },
    });

    await notifyBulkExportReady({
      orgId: job.org_id,
      userId: parsedInput.data.requestedBy,
      fileId: storedFile.id,
      patientCount,
      failedCount: errors.length,
      jobId: job.id,
    });

    return {
      jobId: job.id,
      fileId: storedFile.id,
      patientCount,
      errors,
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '薬歴 PDF ZIP の生成に失敗しました';

    await prisma.integrationJob.update({
      where: { id: job.id },
      data: {
        status: 'failed',
        error_log: message,
        completed_at: new Date(),
        locked_at: null,
      },
    });

    await notifyBulkExportFailed({
      orgId: job.org_id,
      userId: parsedInput.data.requestedBy,
      jobId: job.id,
      message,
    });

    throw cause;
  }
}

export async function drainMedicationHistoryBulkExportQueue(args?: { orgId?: string }) {
  let processedCount = 0;
  const errors: string[] = [];

  while (true) {
    const nextJob = await prisma.integrationJob.findFirst({
      where: {
        job_type: BULK_EXPORT_JOB_TYPE,
        status: 'pending',
        ...(args?.orgId ? { org_id: args.orgId } : {}),
      },
      orderBy: {
        created_at: 'asc',
      },
      select: {
        id: true,
      },
    });

    if (!nextJob) break;

    try {
      const result = await runMedicationHistoryBulkExportJob(nextJob.id);
      if (!result) break;
      processedCount += result.patientCount;
    } catch (cause) {
      errors.push(cause instanceof Error ? cause.message : String(cause));
      break;
    }
  }

  return { processedCount, errors };
}
