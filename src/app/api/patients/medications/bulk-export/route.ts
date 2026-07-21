import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { conflict, error, registeredError, success, validationError } from '@/lib/api/response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import {
  drainMedicationHistoryBulkExportQueue,
  MedicationHistoryBulkExportError,
  queueMedicationHistoryBulkExport,
} from '@/server/services/pdf-bulk-export';
import { logger } from '@/lib/utils/logger';

export const runtime = 'nodejs';

const bulkMedicationExportSchema = z.object({
  patient_ids: z.array(z.string().trim().min(1)).min(1).max(500),
});

async function authenticatedPOST(req: NextRequest, ctx: AuthContext) {
  const trace = {
    requestId: ctx.requestId,
    correlationId: ctx.correlationId,
  };
  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = bulkMedicationExportSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const patientIds = Array.from(new Set(parsed.data.patient_ids));

  try {
    const data = await queueMedicationHistoryBulkExport({
      orgId: ctx.orgId,
      requestedBy: ctx.userId,
      patientIds,
      accessContext: {
        userId: ctx.userId,
        role: ctx.role,
      },
      auditContext: {
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      requestTrace: trace,
    });

    if (data.startedImmediately) {
      void drainMedicationHistoryBulkExportQueue({ orgId: ctx.orgId }).catch((cause) => {
        logger.warn(
          {
            event: 'medication_history_bulk_export.drain_failed',
            orgId: ctx.orgId,
            targetId: data.jobId,
            jobType: 'medication-history-bulk-export-drain',
            operation: 'drain',
            requestId: trace.requestId,
            correlationId: trace.correlationId,
          },
          cause,
        );
      });
    }

    return success({ data }, 202);
  } catch (cause) {
    unstable_rethrow(cause);
    if (cause instanceof MedicationHistoryBulkExportError) {
      if (cause.code === 'WORKFLOW_CONFLICT') {
        return conflict(cause.message);
      }

      return error(cause.code, cause.message, cause.status);
    }

    return registeredError(
      'EXTERNAL_PDF_RENDER_FAILED',
      '薬歴 PDF 一括出力のキュー登録に失敗しました',
    );
  }
}

export const POST = withAuthContext(authenticatedPOST, {
  permission: 'canVisit',
  message: '薬歴 PDF 一括出力の実行権限がありません',
});
