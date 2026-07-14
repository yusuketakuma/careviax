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
import { normalizePharmacyInvoicePdfExportPurpose } from '@/lib/audit/export-purpose-codes';
import { prisma } from '@/lib/db/client';
import { recordDataExportAudit } from '@/server/services/export-audit';
import { PdfNotFoundError } from '@/server/services/pdf-errors';
import { buildPharmacyInvoiceDocumentPdf } from '@/server/services/pdf-pharmacy-invoice';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canManageBilling',
    message: '薬局間請求書 PDF の閲覧権限がありません',
  });
  if ('response' in authResult) return withSensitiveNoStore(authResult.response);
  const ctx = authResult.ctx;
  const tracedSensitiveResponse = <TResponse extends Response>(response: TResponse) =>
    withRequestTraceHeaders(withSensitiveNoStore(response), ctx);

  try {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return tracedSensitiveResponse(validationError('薬局間請求書IDが不正です'));

    const purpose = normalizePharmacyInvoicePdfExportPurpose(
      req.nextUrl.searchParams.get('purpose'),
    );
    if (!purpose) {
      return tracedSensitiveResponse(
        validationError('purpose は1文字以上200文字以内で指定してください'),
      );
    }

    let rendered: Awaited<ReturnType<typeof buildPharmacyInvoiceDocumentPdf>>;
    try {
      rendered = await buildPharmacyInvoiceDocumentPdf(ctx.orgId, id);
    } catch (cause) {
      unstable_rethrow(cause);
      if (cause instanceof PdfNotFoundError) {
        return tracedSensitiveResponse(notFound(cause.message));
      }
      if (cause instanceof Error && cause.message === 'PHARMACY_INVOICE_DOCUMENT_NOT_EXPORTABLE') {
        return tracedSensitiveResponse(
          conflict('無効または取消済みの薬局間請求書はPDF出力できません'),
        );
      }

      return tracedSensitiveResponse(
        registeredError('EXTERNAL_PDF_RENDER_FAILED', '薬局間請求書 PDF を生成できませんでした'),
      );
    }

    try {
      await recordDataExportAudit(prisma, {
        orgId: ctx.orgId,
        actorId: ctx.userId,
        targetType: `pharmacy_${rendered.auditMetadata.document_kind}`,
        targetId: id,
        format: 'pdf',
        recordCount: rendered.auditMetadata.item_count,
        metadata: {
          document_kind: rendered.auditMetadata.document_kind,
          billing_month: rendered.auditMetadata.billing_month,
          status: rendered.auditMetadata.status,
          item_count: rendered.auditMetadata.item_count,
          subtotal: rendered.auditMetadata.subtotal,
          tax_amount: rendered.auditMetadata.tax_amount,
          total: rendered.auditMetadata.total,
          patient_display_mode: rendered.auditMetadata.patient_display_mode,
          export_purpose: purpose,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
        correlationId: ctx.correlationId,
      });
    } catch {
      return tracedSensitiveResponse(
        registeredError(
          'PHARMACY_INVOICE_PDF_EXPORT_AUDIT_FAILED',
          '薬局間請求書 PDF 出力監査を記録できませんでした',
        ),
      );
    }

    return tracedSensitiveResponse(pdfResponse(rendered.buffer, rendered.fileName));
  } catch (err) {
    unstable_rethrow(err);
    return tracedSensitiveResponse(internalError());
  }
}
