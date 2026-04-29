import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import { conflict, error, success, validationError } from '@/lib/api/response';
import {
  drainMedicationHistoryBulkExportQueue,
  MedicationHistoryBulkExportError,
  queueMedicationHistoryBulkExport,
} from '@/server/services/pdf-bulk-export';
import { prisma } from '@/lib/db/client';
import { recordDataExportAudit } from '@/server/services/export-audit';

export const runtime = 'nodejs';

const bulkMedicationExportSchema = z.object({
  patient_ids: z.array(z.string().min(1)).min(1).max(500),
});

export async function POST(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '薬歴 PDF 一括出力の実行権限がありません',
  });
  if ('response' in authResult) return authResult.response;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = bulkMedicationExportSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  try {
    const data = await queueMedicationHistoryBulkExport({
      orgId: authResult.ctx.orgId,
      requestedBy: authResult.ctx.userId,
      patientIds: parsed.data.patient_ids,
      accessContext: {
        userId: authResult.ctx.userId,
        role: authResult.ctx.role,
      },
    });

    if (data.startedImmediately) {
      void drainMedicationHistoryBulkExportQueue({ orgId: authResult.ctx.orgId }).catch(() => {
        // The queued job remains pending and can be drained later via the job endpoint.
      });
    }

    void recordDataExportAudit(prisma, {
      orgId: authResult.ctx.orgId,
      actorId: authResult.ctx.userId,
      targetType: 'medication_history',
      format: 'pdf',
      recordCount: parsed.data.patient_ids.length,
      metadata: { patient_ids: parsed.data.patient_ids },
      ipAddress: authResult.ctx.ipAddress,
      userAgent: authResult.ctx.userAgent,
    }).catch(() => {
      // Audit log failure must not block the export response.
    });

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
