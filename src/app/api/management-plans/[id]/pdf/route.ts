import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { error, notFound, validationError } from '@/lib/api/response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { pdfResponse } from '@/lib/api/pdf-response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { recordDataExportAudit } from '@/server/services/export-audit';
import { buildManagementPlanPdf } from '@/server/services/pdf-documents';
import { PdfNotFoundError } from '@/server/services/pdf-errors';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '管理計画書 PDF の閲覧権限がありません',
  });
  if ('response' in authResult) return withSensitiveNoStore(authResult.response);

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return withSensitiveNoStore(validationError('管理計画書IDが不正です'));

  try {
    const rendered = await buildManagementPlanPdf(authResult.ctx.orgId, id, {
      userId: authResult.ctx.userId,
      role: authResult.ctx.role,
    });
    await recordDataExportAudit(prisma, {
      orgId: authResult.ctx.orgId,
      actorId: authResult.ctx.userId,
      targetType: 'management_plan',
      targetId: id,
      format: 'pdf',
      recordCount: 1,
      ipAddress: authResult.ctx.ipAddress,
      userAgent: authResult.ctx.userAgent,
    });
    return withSensitiveNoStore(pdfResponse(rendered.buffer, rendered.fileName));
  } catch (cause) {
    unstable_rethrow(cause);
    if (cause instanceof PdfNotFoundError) {
      return withSensitiveNoStore(notFound(cause.message));
    }

    return withSensitiveNoStore(
      error('EXTERNAL_PDF_RENDER_FAILED', '管理計画書 PDF を生成できませんでした', 500),
    );
  }
}
