import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { error, notFound, validationError } from '@/lib/api/response';
import { pdfResponse } from '@/lib/api/pdf-response';
import { prisma } from '@/lib/db/client';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { recordDataExportAudit } from '@/server/services/export-audit';
import { buildPatientVisitRecordsPdf } from '@/server/services/pdf-documents';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問記録一覧 PDF の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');

  const url = new URL(req.url);

  try {
    const rendered = await buildPatientVisitRecordsPdf(
      authResult.ctx.orgId,
      id,
      url.searchParams.get('date_from'),
      url.searchParams.get('date_to'),
      {
        userId: authResult.ctx.userId,
        role: authResult.ctx.role,
      },
    );
    await recordDataExportAudit(prisma, {
      orgId: authResult.ctx.orgId,
      actorId: authResult.ctx.userId,
      targetType: 'visit_record_list',
      targetId: id,
      format: 'pdf',
      recordCount: 1,
      filters: {
        date_from: url.searchParams.get('date_from'),
        date_to: url.searchParams.get('date_to'),
      },
      ipAddress: authResult.ctx.ipAddress,
      userAgent: authResult.ctx.userAgent,
    });
    return pdfResponse(rendered.buffer, rendered.fileName);
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('見つかりません')) {
      return notFound(cause.message);
    }

    return error('EXTERNAL_PDF_RENDER_FAILED', '訪問記録一覧 PDF を生成できませんでした', 500);
  }
}
