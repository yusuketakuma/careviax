import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { withAuthContext, type AuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { conflict, notFound, registeredError, validationError } from '@/lib/api/response';
import { pdfResponse } from '@/lib/api/pdf-response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { prisma } from '@/lib/db/client';
import { recordDataExportAudit } from '@/server/services/export-audit';
import {
  PdfNotFoundError,
  UnsupportedCareReportPdfContentError,
} from '@/server/services/pdf-errors';
import { buildCareReportPdf } from '@/server/services/pdf-documents';

export const runtime = 'nodejs';

async function careReportPdfGET(
  _req: NextRequest,
  ctx: AuthContext,
  { params }: AuthRouteContext<{ id: string }>,
) {
  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('報告書IDが不正です');

  let rendered: Awaited<ReturnType<typeof buildCareReportPdf>>;
  try {
    rendered = await buildCareReportPdf(ctx.orgId, id, {
      userId: ctx.userId,
      role: ctx.role,
    });
  } catch (cause) {
    unstable_rethrow(cause);
    if (cause instanceof PdfNotFoundError) {
      return notFound(cause.message);
    }
    if (cause instanceof Error && cause.message === 'CARE_REPORT_NOT_CONFIRMED') {
      return conflict('薬剤師確認済みの報告書のみPDF出力できます');
    }
    if (cause instanceof UnsupportedCareReportPdfContentError) {
      return conflict(cause.message);
    }

    return registeredError('EXTERNAL_PDF_RENDER_FAILED', '報告書 PDF を生成できませんでした');
  }

  try {
    await recordDataExportAudit(prisma, {
      orgId: ctx.orgId,
      actorId: ctx.userId,
      targetType: 'care_report',
      targetId: id,
      format: 'pdf',
      recordCount: 1,
      metadata: {
        surface: 'care_report_pdf',
        output_profile: 'external_submission_pdf',
        report_updated_at: rendered.reportUpdatedAt.toISOString(),
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      correlationId: ctx.correlationId,
    });
  } catch {
    return registeredError(
      'CARE_REPORT_PDF_EXPORT_AUDIT_FAILED',
      '報告書 PDF 出力監査を記録できませんでした',
    );
  }

  return pdfResponse(rendered.buffer, rendered.fileName);
}

export const GET = withAuthContext(careReportPdfGET, {
  permission: 'canSendCareReport',
  message: '報告書 PDF の出力権限がありません',
});
