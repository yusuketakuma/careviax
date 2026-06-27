import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { error, notFound, validationError } from '@/lib/api/response';
import { pdfResponse } from '@/lib/api/pdf-response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { recordDataExportAudit } from '@/server/services/export-audit';
import { buildMedicationCalendarPdf } from '@/server/services/pdf-documents';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '服薬カレンダー PDF の閲覧権限がありません',
  });
  if ('response' in authResult) return withSensitiveNoStore(authResult.response);

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return withSensitiveNoStore(validationError('患者IDが不正です'));

  const { searchParams } = new URL(req.url);

  try {
    const rendered = await buildMedicationCalendarPdf(
      authResult.ctx.orgId,
      id,
      searchParams.get('month'),
      {
        userId: authResult.ctx.userId,
        role: authResult.ctx.role,
      },
    );
    await recordDataExportAudit(prisma, {
      orgId: authResult.ctx.orgId,
      actorId: authResult.ctx.userId,
      targetType: 'medication_calendar',
      targetId: id,
      format: 'pdf',
      recordCount: 1,
      filters: {
        month: searchParams.get('month'),
      },
      ipAddress: authResult.ctx.ipAddress,
      userAgent: authResult.ctx.userAgent,
    });
    return withSensitiveNoStore(pdfResponse(rendered.buffer, rendered.fileName));
  } catch (cause) {
    unstable_rethrow(cause);
    if (cause instanceof Error && cause.message.includes('見つかりません')) {
      return withSensitiveNoStore(notFound(cause.message));
    }

    return withSensitiveNoStore(
      error('EXTERNAL_PDF_RENDER_FAILED', '服薬カレンダー PDF を生成できませんでした', 500),
    );
  }
}
