import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { error, conflict, notFound, validationError } from '@/lib/api/response';
import { pdfResponse } from '@/lib/api/pdf-response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { recordDataExportAudit } from '@/server/services/export-audit';
import { PdfNotFoundError } from '@/server/services/pdf-errors';
import { buildPharmacyInvoiceDocumentPdf } from '@/server/services/pdf-pharmacy-invoice';

export const runtime = 'nodejs';

function parseExportPurpose(value: string | null) {
  const trimmed = value?.trim() ?? '';
  if (trimmed.length === 0 || trimmed.length > 200) return null;
  return trimmed;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canManageBilling',
    message: '薬局間請求書 PDF の閲覧権限がありません',
  });
  if ('response' in authResult) return withSensitiveNoStore(authResult.response);

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return withSensitiveNoStore(validationError('薬局間請求書IDが不正です'));

  const purpose = parseExportPurpose(req.nextUrl.searchParams.get('purpose'));
  if (!purpose) {
    return withSensitiveNoStore(
      validationError('purpose は1文字以上200文字以内で指定してください'),
    );
  }

  try {
    const rendered = await buildPharmacyInvoiceDocumentPdf(authResult.ctx.orgId, id);
    await recordDataExportAudit(prisma, {
      orgId: authResult.ctx.orgId,
      actorId: authResult.ctx.userId,
      targetType: `pharmacy_${rendered.auditMetadata.document_kind}`,
      targetId: id,
      format: 'pdf',
      recordCount: rendered.auditMetadata.item_count,
      metadata: {
        ...rendered.auditMetadata,
        export_purpose: purpose,
      },
      ipAddress: authResult.ctx.ipAddress,
      userAgent: authResult.ctx.userAgent,
    });

    return withSensitiveNoStore(pdfResponse(rendered.buffer, rendered.fileName));
  } catch (cause) {
    if (cause instanceof PdfNotFoundError) {
      return withSensitiveNoStore(notFound(cause.message));
    }
    if (cause instanceof Error && cause.message === 'PHARMACY_INVOICE_DOCUMENT_NOT_EXPORTABLE') {
      return withSensitiveNoStore(conflict('無効または取消済みの薬局間請求書はPDF出力できません'));
    }

    return withSensitiveNoStore(
      error('EXTERNAL_PDF_RENDER_FAILED', '薬局間請求書 PDF を生成できませんでした', 500),
    );
  }
}
