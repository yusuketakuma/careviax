import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { error, notFound, validationError, conflict } from '@/lib/api/response';
import { pdfResponse } from '@/lib/api/pdf-response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { prisma } from '@/lib/db/client';
import { recordDataExportAudit } from '@/server/services/export-audit';
import { buildBillingDocumentPdf } from '@/server/services/pdf-documents';

export const runtime = 'nodejs';

function parseBillingDocumentKind(value: string | null) {
  return value === 'receipt' || value === 'invoice' ? value : null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canManageBilling',
    message: '請求書類 PDF の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('請求候補IDが不正です');

  const kind = parseBillingDocumentKind(req.nextUrl.searchParams.get('kind'));
  if (!kind) return validationError('kind は receipt または invoice を指定してください');

  try {
    const rendered = await buildBillingDocumentPdf(authResult.ctx.orgId, id, kind);
    await recordDataExportAudit(prisma, {
      orgId: authResult.ctx.orgId,
      actorId: authResult.ctx.userId,
      targetType: `billing_${kind}`,
      targetId: id,
      format: 'pdf',
      recordCount: 1,
      ipAddress: authResult.ctx.ipAddress,
      userAgent: authResult.ctx.userAgent,
    });
    return pdfResponse(rendered.buffer, rendered.fileName);
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('見つかりません')) {
      return notFound(cause.message);
    }
    if (cause instanceof Error && cause.message === 'BILLING_DOCUMENT_NOT_ISSUED') {
      return conflict('発行済みの領収証または請求書のみPDF出力できます');
    }

    return error('EXTERNAL_PDF_RENDER_FAILED', '請求書類 PDF を生成できませんでした', 500);
  }
}
