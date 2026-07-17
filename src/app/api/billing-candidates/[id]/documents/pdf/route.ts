import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { conflict, notFound, registeredError, validationError } from '@/lib/api/response';
import { pdfResponse } from '@/lib/api/pdf-response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withAuthContext, type AuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { recordDataExportAudit } from '@/server/services/export-audit';
import { buildBillingDocumentPdf } from '@/server/services/pdf-documents';
import { PdfNotFoundError } from '@/server/services/pdf-errors';

export const runtime = 'nodejs';

function parseBillingDocumentKind(value: string | null) {
  return value === 'receipt' || value === 'invoice' ? value : null;
}

async function billingDocumentPdfGET(
  req: NextRequest,
  ctx: AuthContext,
  { params }: AuthRouteContext<{ id: string }>,
) {
  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('請求候補IDが不正です');

  const kind = parseBillingDocumentKind(req.nextUrl.searchParams.get('kind'));
  if (!kind) {
    return validationError('kind は receipt または invoice を指定してください');
  }

  let rendered: Awaited<ReturnType<typeof buildBillingDocumentPdf>>;
  try {
    rendered = await buildBillingDocumentPdf(ctx.orgId, id, kind);
  } catch (cause) {
    unstable_rethrow(cause);
    if (cause instanceof PdfNotFoundError) {
      return notFound(cause.message);
    }
    if (cause instanceof Error && cause.message === 'BILLING_DOCUMENT_NOT_ISSUED') {
      return conflict('発行済みの領収証または請求書のみPDF出力できます');
    }

    return registeredError('EXTERNAL_PDF_RENDER_FAILED', '請求書類 PDF を生成できませんでした');
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
    return registeredError(
      'BILLING_DOCUMENT_PDF_EXPORT_AUDIT_FAILED',
      '請求書類 PDF 出力監査を記録できませんでした',
    );
  }

  return pdfResponse(rendered.buffer, rendered.fileName);
}

export const GET = withAuthContext(billingDocumentPdfGET, {
  permission: 'canManageBilling',
  message: '請求書類 PDF の閲覧権限がありません',
});
