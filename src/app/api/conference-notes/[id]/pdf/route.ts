import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { error, notFound, validationError } from '@/lib/api/response';
import { pdfResponse } from '@/lib/api/pdf-response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { prisma } from '@/lib/db/client';
import { recordDataExportAudit } from '@/server/services/export-audit';
import { buildConferenceNotePdf } from '@/server/services/pdf-documents';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canReport',
    message: 'カンファレンス記録 PDF の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('カンファレンス記録IDが不正です');

  try {
    const rendered = await buildConferenceNotePdf(authResult.ctx.orgId, id, {
      userId: authResult.ctx.userId,
      role: authResult.ctx.role,
    });
    await recordDataExportAudit(prisma, {
      orgId: authResult.ctx.orgId,
      actorId: authResult.ctx.userId,
      targetType: 'conference_note',
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

    return error(
      'EXTERNAL_PDF_RENDER_FAILED',
      'カンファレンス記録 PDF を生成できませんでした',
      500,
    );
  }
}
