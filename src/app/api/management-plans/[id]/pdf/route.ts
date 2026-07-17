import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { withAuthContext, type AuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { notFound, registeredError, validationError } from '@/lib/api/response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { pdfResponse } from '@/lib/api/pdf-response';
import { prisma } from '@/lib/db/client';
import { recordDataExportAudit } from '@/server/services/export-audit';
import { buildManagementPlanPdf } from '@/server/services/pdf-documents';
import { PdfNotFoundError } from '@/server/services/pdf-errors';

export const runtime = 'nodejs';

async function managementPlanPdfGET(
  _req: NextRequest,
  ctx: AuthContext,
  { params }: AuthRouteContext<{ id: string }>,
) {
  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('管理計画書IDが不正です');

  let rendered: Awaited<ReturnType<typeof buildManagementPlanPdf>>;
  try {
    rendered = await buildManagementPlanPdf(ctx.orgId, id, {
      userId: ctx.userId,
      role: ctx.role,
    });
  } catch (cause) {
    unstable_rethrow(cause);
    if (cause instanceof PdfNotFoundError) {
      return notFound(cause.message);
    }

    return registeredError('EXTERNAL_PDF_RENDER_FAILED', '管理計画書 PDF を生成できませんでした');
  }

  try {
    await recordDataExportAudit(prisma, {
      orgId: ctx.orgId,
      actorId: ctx.userId,
      targetType: 'management_plan',
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
      'MANAGEMENT_PLAN_PDF_EXPORT_AUDIT_FAILED',
      '管理計画書 PDF 出力監査を記録できませんでした',
    );
  }

  return pdfResponse(rendered.buffer, rendered.fileName);
}

export const GET = withAuthContext<{ id: string }, Response>(managementPlanPdfGET, {
  permission: 'canVisit',
  message: '管理計画書 PDF の閲覧権限がありません',
});
