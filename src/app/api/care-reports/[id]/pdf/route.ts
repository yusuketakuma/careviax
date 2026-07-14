import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import {
  conflict,
  internalError,
  notFound,
  registeredError,
  validationError,
} from '@/lib/api/response';
import { pdfResponse } from '@/lib/api/pdf-response';
import { withRequestTraceHeaders } from '@/lib/api/request-correlation';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { prisma } from '@/lib/db/client';
import { recordDataExportAudit } from '@/server/services/export-audit';
import {
  PdfNotFoundError,
  UnsupportedCareReportPdfContentError,
} from '@/server/services/pdf-errors';
import { buildCareReportPdf } from '@/server/services/pdf-documents';

export const runtime = 'nodejs';

async function authenticatedGET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canSendCareReport',
    message: '報告書 PDF の出力権限がありません',
  });
  if ('response' in authResult) return withSensitiveNoStore(authResult.response);
  const ctx = authResult.ctx;
  const tracedSensitiveResponse = <TResponse extends Response>(response: TResponse) =>
    withRequestTraceHeaders(withSensitiveNoStore(response), ctx);

  try {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return tracedSensitiveResponse(validationError('報告書IDが不正です'));

    let rendered: Awaited<ReturnType<typeof buildCareReportPdf>>;
    try {
      rendered = await buildCareReportPdf(ctx.orgId, id, {
        userId: ctx.userId,
        role: ctx.role,
      });
    } catch (cause) {
      unstable_rethrow(cause);
      if (cause instanceof PdfNotFoundError) {
        return tracedSensitiveResponse(notFound(cause.message));
      }
      if (cause instanceof Error && cause.message === 'CARE_REPORT_NOT_CONFIRMED') {
        return tracedSensitiveResponse(conflict('薬剤師確認済みの報告書のみPDF出力できます'));
      }
      if (cause instanceof UnsupportedCareReportPdfContentError) {
        return tracedSensitiveResponse(conflict(cause.message));
      }

      return tracedSensitiveResponse(
        registeredError('EXTERNAL_PDF_RENDER_FAILED', '報告書 PDF を生成できませんでした'),
      );
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
      return tracedSensitiveResponse(
        registeredError(
          'CARE_REPORT_PDF_EXPORT_AUDIT_FAILED',
          '報告書 PDF 出力監査を記録できませんでした',
        ),
      );
    }

    return tracedSensitiveResponse(pdfResponse(rendered.buffer, rendered.fileName));
  } catch (err) {
    unstable_rethrow(err);
    return tracedSensitiveResponse(internalError());
  }
}

export async function GET(req: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
}
