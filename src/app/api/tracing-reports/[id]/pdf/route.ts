import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { error, notFound, validationError } from '@/lib/api/response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { pdfResponse } from '@/lib/api/pdf-response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { recordDataExportAudit } from '@/server/services/export-audit';
import { buildTracingReportPdf } from '@/server/services/pdf-documents';
import { PdfNotFoundError } from '@/server/services/pdf-errors';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canReport',
    message: 'トレーシングレポート PDF の閲覧権限がありません',
  });
  if ('response' in authResult) return withSensitiveNoStore(authResult.response);

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return withSensitiveNoStore(validationError('トレーシングレポートIDが不正です'));

  let rendered: Awaited<ReturnType<typeof buildTracingReportPdf>>;
  try {
    rendered = await buildTracingReportPdf(authResult.ctx.orgId, id, {
      userId: authResult.ctx.userId,
      role: authResult.ctx.role,
    });
  } catch (cause) {
    unstable_rethrow(cause);
    if (cause instanceof PdfNotFoundError) {
      return withSensitiveNoStore(notFound(cause.message));
    }

    return withSensitiveNoStore(
      error('EXTERNAL_PDF_RENDER_FAILED', 'トレーシングレポート PDF を生成できませんでした', 500),
    );
  }

  try {
    await recordDataExportAudit(prisma, {
      orgId: authResult.ctx.orgId,
      actorId: authResult.ctx.userId,
      targetType: 'tracing_report',
      targetId: id,
      format: 'pdf',
      recordCount: 1,
      metadata: {
        surface: 'tracing_report_pdf',
        output_profile: 'internal_pdf',
      },
      ipAddress: authResult.ctx.ipAddress,
      userAgent: authResult.ctx.userAgent,
    });
  } catch {
    return withSensitiveNoStore(
      error(
        'TRACING_REPORT_PDF_EXPORT_AUDIT_FAILED',
        'トレーシングレポート PDF 出力監査を記録できませんでした',
        500,
      ),
    );
  }

  return withSensitiveNoStore(pdfResponse(rendered.buffer, rendered.fileName));
}
