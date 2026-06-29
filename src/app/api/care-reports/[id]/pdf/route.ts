import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { conflict, error, notFound, validationError } from '@/lib/api/response';
import { pdfResponse } from '@/lib/api/pdf-response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { prisma } from '@/lib/db/client';
import { recordDataExportAudit } from '@/server/services/export-audit';
import { PdfNotFoundError } from '@/server/services/pdf-errors';
import { buildCareReportPdf } from '@/server/services/pdf-documents';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canSendCareReport',
    message: '報告書 PDF の出力権限がありません',
  });
  if ('response' in authResult) return withSensitiveNoStore(authResult.response);

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return withSensitiveNoStore(validationError('報告書IDが不正です'));

  let rendered: Awaited<ReturnType<typeof buildCareReportPdf>>;
  try {
    rendered = await buildCareReportPdf(authResult.ctx.orgId, id, {
      userId: authResult.ctx.userId,
      role: authResult.ctx.role,
    });
  } catch (cause) {
    unstable_rethrow(cause);
    if (cause instanceof PdfNotFoundError) {
      return withSensitiveNoStore(notFound(cause.message));
    }
    if (cause instanceof Error && cause.message === 'CARE_REPORT_NOT_CONFIRMED') {
      return withSensitiveNoStore(conflict('薬剤師確認済みの報告書のみPDF出力できます'));
    }

    return withSensitiveNoStore(
      error('EXTERNAL_PDF_RENDER_FAILED', '報告書 PDF を生成できませんでした', 500),
    );
  }

  try {
    await recordDataExportAudit(prisma, {
      orgId: authResult.ctx.orgId,
      actorId: authResult.ctx.userId,
      targetType: 'care_report',
      targetId: id,
      format: 'pdf',
      recordCount: 1,
      metadata: {
        report_updated_at: rendered.reportUpdatedAt.toISOString(),
      },
      ipAddress: authResult.ctx.ipAddress,
      userAgent: authResult.ctx.userAgent,
    });
  } catch {
    return withSensitiveNoStore(
      error(
        'CARE_REPORT_PDF_EXPORT_AUDIT_FAILED',
        '報告書 PDF 出力監査を記録できませんでした',
        500,
      ),
    );
  }

  return withSensitiveNoStore(pdfResponse(rendered.buffer, rendered.fileName));
}
