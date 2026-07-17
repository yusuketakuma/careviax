import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { withAuthContext, type AuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { notFound, registeredError, validationError } from '@/lib/api/response';
import { pdfResponse } from '@/lib/api/pdf-response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { prisma } from '@/lib/db/client';
import { recordDataExportAudit } from '@/server/services/export-audit';
import { PdfNotFoundError } from '@/server/services/pdf-errors';
import { buildVisitRecordPdf } from '@/server/services/pdf-documents';

export const runtime = 'nodejs';

async function visitRecordPdfGET(
  _req: NextRequest,
  ctx: AuthContext,
  { params }: AuthRouteContext<{ id: string }>,
) {
  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('訪問記録IDが不正です');

  let rendered: Awaited<ReturnType<typeof buildVisitRecordPdf>>;
  try {
    rendered = await buildVisitRecordPdf(ctx.orgId, id, {
      userId: ctx.userId,
      role: ctx.role,
    });
  } catch (cause) {
    unstable_rethrow(cause);
    if (cause instanceof PdfNotFoundError) {
      return notFound(cause.message);
    }

    return registeredError('EXTERNAL_PDF_RENDER_FAILED', '訪問記録 PDF を生成できませんでした');
  }

  try {
    await recordDataExportAudit(prisma, {
      orgId: ctx.orgId,
      actorId: ctx.userId,
      targetType: 'visit_record',
      targetId: id,
      format: 'pdf',
      recordCount: 1,
      metadata: {
        surface: 'visit_record_pdf',
        output_profile: 'internal_pdf',
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      correlationId: ctx.correlationId,
    });
  } catch {
    return registeredError(
      'VISIT_RECORD_PDF_EXPORT_AUDIT_FAILED',
      '訪問記録 PDF 出力監査を記録できませんでした',
    );
  }

  return pdfResponse(rendered.buffer, rendered.fileName);
}

export const GET = withAuthContext<{ id: string }, Response>(visitRecordPdfGET, {
  permission: 'canVisit',
  message: '訪問記録 PDF の閲覧権限がありません',
});
