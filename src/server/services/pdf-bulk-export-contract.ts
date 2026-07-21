import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { isValidRequestTraceId, type RequestTraceContext } from '@/lib/api/request-correlation';
import type { RequestAuthContext } from '@/lib/auth/request-context';
import type { VisitScheduleAccessContext } from '@/lib/auth/visit-schedule-access';
import { withOrgContext } from '@/lib/db/rls';

export const MAX_PATIENTS_PER_EXPORT = 500;
const SERIALIZABLE_RETRY_LIMIT = 3;
const BYTES_PER_MIB = 1024 * 1024;
const DEFAULT_MAX_TOTAL_PDF_BYTES = 128 * BYTES_PER_MIB;
const MAX_TOTAL_PDF_BYTES_ENV = 'MEDICATION_HISTORY_BULK_EXPORT_MAX_TOTAL_PDF_BYTES';
const GENERIC_BULK_EXPORT_FAILURE_MESSAGE = '薬歴 PDF ZIP の生成に失敗しました';

export const bulkExportPatientIdsSchema = z
  .array(z.string().trim().min(1))
  .min(1)
  .max(MAX_PATIENTS_PER_EXPORT)
  .transform((values) => uniqueStrings(values));

export const bulkExportInputSchema = z.object({
  version: z.literal(1).default(1),
  requestedBy: z.string().trim().min(1),
  patientIds: bulkExportPatientIdsSchema,
});

export type QueueMedicationHistoryBulkExportArgs = {
  orgId: string;
  requestedBy: string;
  patientIds: string[];
  accessContext: VisitScheduleAccessContext;
  auditContext?: {
    ipAddress?: string;
    userAgent?: string;
  };
  requestTrace?: {
    requestId?: unknown;
    correlationId?: unknown;
  };
};

export type MedicationHistoryBulkExportResult = {
  jobId: string;
  fileId: string;
  patientCount: number;
  errors?: string[];
};

export type BulkExportRenderErrorCode = 'pdf_not_found' | 'render_failed';

export type BulkExportRenderError = {
  code: BulkExportRenderErrorCode;
  message: string;
};

export type PdfRenderResult =
  | {
      patientId: string;
      fileName: string;
      buffer: Buffer;
    }
  | {
      patientId: string;
      error: string;
      errorCode: BulkExportRenderErrorCode;
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

export class BulkExportLockLostError extends Error {
  constructor(readonly jobId: string) {
    super('bulk export job lock was lost');
    this.name = 'BulkExportLockLostError';
  }
}

export function getSafeBulkExportFailureMessage(cause: unknown) {
  return cause instanceof MedicationHistoryBulkExportError
    ? cause.message
    : GENERIC_BULK_EXPORT_FAILURE_MESSAGE;
}

export function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

export function buildPatientSelectionHash(orgId: string, patientIds: string[]) {
  return createHash('sha256')
    .update(orgId)
    .update('\0')
    .update([...patientIds].sort().join('\0'))
    .digest('hex');
}

export function validateRequestTracePair(
  requestId: unknown,
  correlationId: unknown,
): RequestTraceContext | undefined {
  if (!isValidRequestTraceId(requestId) || !isValidRequestTraceId(correlationId)) {
    return undefined;
  }

  return { requestId, correlationId };
}

export function readPersistedRequestTrace(
  input: Prisma.JsonValue,
): RequestTraceContext | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;

  const requestTrace = (input as Record<string, unknown>).request_trace;
  if (!requestTrace || typeof requestTrace !== 'object' || Array.isArray(requestTrace)) {
    return undefined;
  }

  const traceRecord = requestTrace as Record<string, unknown>;
  return validateRequestTracePair(traceRecord.request_id, traceRecord.correlation_id);
}

export function buildPersistedRequestTrace(requestTrace: RequestTraceContext | undefined) {
  return requestTrace
    ? {
        request_trace: {
          request_id: requestTrace.requestId,
          correlation_id: requestTrace.correlationId,
        },
      }
    : {};
}

export function buildTerminalBulkExportInput(args: {
  orgId: string;
  requestedBy: string;
  patientIds: string[];
  requestTrace?: RequestTraceContext;
}) {
  return {
    version: 1,
    requestedBy: args.requestedBy,
    patient_count: args.patientIds.length,
    patient_selection_hash: buildPatientSelectionHash(args.orgId, args.patientIds),
    ...buildPersistedRequestTrace(args.requestTrace),
  } satisfies Prisma.InputJsonValue;
}

export function buildInvalidTerminalBulkExportInput(
  input: Prisma.JsonValue,
  requestTrace: RequestTraceContext | undefined,
) {
  const requestedBy =
    input && typeof input === 'object' && !Array.isArray(input) && 'requestedBy' in input
      ? (input as Record<string, unknown>).requestedBy
      : null;

  return {
    version: 1,
    requestedBy:
      typeof requestedBy === 'string' && requestedBy.trim() ? requestedBy.trim() : 'unknown',
    invalid_input: true,
    ...buildPersistedRequestTrace(requestTrace),
  } satisfies Prisma.InputJsonValue;
}

export function buildTimeoutTerminalBulkExportInput() {
  return {
    version: 1,
    terminal_reason: 'timeout',
    input_redacted: true,
  } satisfies Prisma.InputJsonValue;
}

export function summarizeBulkExportRenderErrors(errors: BulkExportRenderError[]) {
  return errors.reduce<Record<BulkExportRenderErrorCode, number>>(
    (summary, error) => {
      summary[error.code] += 1;
      return summary;
    },
    { pdf_not_found: 0, render_failed: 0 },
  );
}

export function formatTimestampForFileName(date = new Date()) {
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

export function getMaxTotalPdfBytes() {
  const value = Number(process.env[MAX_TOTAL_PDF_BYTES_ENV]);
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_MAX_TOTAL_PDF_BYTES;
  }

  const normalized = Math.floor(value);
  return Number.isSafeInteger(normalized) && normalized > 0
    ? normalized
    : DEFAULT_MAX_TOTAL_PDF_BYTES;
}

export function getZipEntriesTotalBytes(zipEntries: Record<string, Uint8Array>) {
  return Object.values(zipEntries).reduce((total, entry) => total + entry.byteLength, 0);
}

export function assertBulkExportTotalPdfBytes(zipEntries: Record<string, Uint8Array>) {
  const totalPdfBytes = getZipEntriesTotalBytes(zipEntries);
  const maxTotalPdfBytes = getMaxTotalPdfBytes();
  if (totalPdfBytes > maxTotalPdfBytes) {
    throw new MedicationHistoryBulkExportError(
      'WORKFLOW_CONFLICT',
      '薬歴 PDF 一括出力の合計サイズが上限を超えました。対象患者を分割して再実行してください。',
      409,
    );
  }
}

export async function withOrgSerializableRetry<TValue>(args: {
  orgId: string;
  requestContext?: RequestAuthContext;
  work: (tx: Prisma.TransactionClient) => Promise<TValue>;
}): Promise<TValue> {
  for (let attempt = 0; attempt < SERIALIZABLE_RETRY_LIMIT; attempt += 1) {
    try {
      return await withOrgContext(args.orgId, args.work, {
        requestContext: args.requestContext,
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

  throw new Error('org-scoped bulk export transaction could not be completed');
}
