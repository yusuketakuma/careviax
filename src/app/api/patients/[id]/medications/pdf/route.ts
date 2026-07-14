import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { internalError, notFound, registeredError, validationError } from '@/lib/api/response';
import { pdfResponse } from '@/lib/api/pdf-response';
import { withRequestTraceHeaders } from '@/lib/api/request-correlation';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { recordDataExportAudit } from '@/server/services/export-audit';
import { buildMedicationHistoryPdf } from '@/server/services/pdf-documents';
import { PdfNotFoundError } from '@/server/services/pdf-errors';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '薬歴 PDF の閲覧権限がありません',
  });
  if ('response' in authResult) return withSensitiveNoStore(authResult.response);
  const ctx = authResult.ctx;
  const tracedSensitiveResponse = <TResponse extends Response>(response: TResponse) =>
    withRequestTraceHeaders(withSensitiveNoStore(response), ctx);

  try {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return tracedSensitiveResponse(validationError('患者IDが不正です'));

    let rendered: Awaited<ReturnType<typeof buildMedicationHistoryPdf>>;
    try {
      rendered = await buildMedicationHistoryPdf(ctx.orgId, id, {
        userId: ctx.userId,
        role: ctx.role,
      });
    } catch (cause) {
      unstable_rethrow(cause);
      if (cause instanceof PdfNotFoundError) {
        return tracedSensitiveResponse(notFound(cause.message));
      }

      return tracedSensitiveResponse(
        registeredError('EXTERNAL_PDF_RENDER_FAILED', '薬歴 PDF を生成できませんでした'),
      );
    }

    try {
      await recordDataExportAudit(prisma, {
        orgId: ctx.orgId,
        actorId: ctx.userId,
        targetType: 'medication_history',
        targetId: id,
        format: 'pdf',
        recordCount: 1,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
        correlationId: ctx.correlationId,
      });
    } catch {
      return tracedSensitiveResponse(
        registeredError(
          'MEDICATION_HISTORY_PDF_EXPORT_AUDIT_FAILED',
          '薬歴 PDF 出力監査を記録できませんでした',
        ),
      );
    }

    return tracedSensitiveResponse(pdfResponse(rendered.buffer, rendered.fileName));
  } catch (err) {
    unstable_rethrow(err);
    return tracedSensitiveResponse(internalError());
  }
}
