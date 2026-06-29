import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import { conflict, error, internalError, success, validationError } from '@/lib/api/response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import {
  drainMedicationHistoryBulkExportQueue,
  MedicationHistoryBulkExportError,
  queueMedicationHistoryBulkExport,
} from '@/server/services/pdf-bulk-export';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';

export const runtime = 'nodejs';

const bulkMedicationExportSchema = z.object({
  patient_ids: z.array(z.string().trim().min(1)).min(1).max(500),
});

async function authenticatedPOST(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '薬歴 PDF 一括出力の実行権限がありません',
  });
  if ('response' in authResult) return authResult.response;

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = bulkMedicationExportSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const patientIds = Array.from(new Set(parsed.data.patient_ids));

  try {
    const data = await queueMedicationHistoryBulkExport({
      orgId: authResult.ctx.orgId,
      requestedBy: authResult.ctx.userId,
      patientIds,
      accessContext: {
        userId: authResult.ctx.userId,
        role: authResult.ctx.role,
      },
      auditContext: {
        ipAddress: authResult.ctx.ipAddress,
        userAgent: authResult.ctx.userAgent,
      },
    });

    if (data.startedImmediately) {
      void drainMedicationHistoryBulkExportQueue({ orgId: authResult.ctx.orgId }).catch(() => {
        // The queued job remains pending and can be drained later via the job endpoint.
      });
    }

    return success({ data }, 202);
  } catch (cause) {
    if (cause instanceof MedicationHistoryBulkExportError) {
      if (cause.code === 'WORKFLOW_CONFLICT') {
        return conflict(cause.message);
      }

      return error(cause.code, cause.message, cause.status);
    }

    return error('EXTERNAL_PDF_RENDER_FAILED', '薬歴 PDF 一括出力のキュー登録に失敗しました', 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    return withSensitiveNoStore(await authenticatedPOST(req));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
}
