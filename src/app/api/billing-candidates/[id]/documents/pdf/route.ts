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
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { recordDataExportAudit } from '@/server/services/export-audit';
import { buildBillingDocumentPdf } from '@/server/services/pdf-documents';
import { PdfNotFoundError } from '@/server/services/pdf-errors';

export const runtime = 'nodejs';

function parseBillingDocumentKind(value: string | null) {
  return value === 'receipt' || value === 'invoice' ? value : null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canManageBilling',
    message: '請求書類 PDF の閲覧権限がありません',
  });
  if ('response' in authResult) return withSensitiveNoStore(authResult.response);
  const ctx = authResult.ctx;
  const tracedSensitiveResponse = <TResponse extends Response>(response: TResponse) =>
    withRequestTraceHeaders(withSensitiveNoStore(response), ctx);

  try {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return tracedSensitiveResponse(validationError('請求候補IDが不正です'));

    const kind = parseBillingDocumentKind(req.nextUrl.searchParams.get('kind'));
    if (!kind) {
      return tracedSensitiveResponse(
        validationError('kind は receipt または invoice を指定してください'),
      );
    }

    let rendered: Awaited<ReturnType<typeof buildBillingDocumentPdf>>;
    try {
      rendered = await buildBillingDocumentPdf(ctx.orgId, id, kind);
    } catch (cause) {
      unstable_rethrow(cause);
      if (cause instanceof PdfNotFoundError) {
        return tracedSensitiveResponse(notFound(cause.message));
      }
      if (cause instanceof Error && cause.message === 'BILLING_DOCUMENT_NOT_ISSUED') {
        return tracedSensitiveResponse(conflict('発行済みの領収証または請求書のみPDF出力できます'));
      }

      return tracedSensitiveResponse(
        registeredError('EXTERNAL_PDF_RENDER_FAILED', '請求書類 PDF を生成できませんでした'),
      );
    }

    try {
      await recordDataExportAudit(prisma, {
        orgId: ctx.orgId,
        actorId: ctx.userId,
        targetType: `billing_${kind}`,
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
          'BILLING_DOCUMENT_PDF_EXPORT_AUDIT_FAILED',
          '請求書類 PDF 出力監査を記録できませんでした',
        ),
      );
    }

    return tracedSensitiveResponse(pdfResponse(rendered.buffer, rendered.fileName));
  } catch (err) {
    unstable_rethrow(err);
    return tracedSensitiveResponse(internalError());
  }
}
