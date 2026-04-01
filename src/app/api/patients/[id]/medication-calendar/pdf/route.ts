import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { error, notFound } from '@/lib/api/response';
import { pdfResponse } from '@/lib/api/pdf-response';
import { prisma } from '@/lib/db/client';
import { recordDataExportAudit } from '@/server/services/export-audit';
import { buildMedicationCalendarPdf } from '@/server/services/pdf-documents';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '服薬カレンダー PDF の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;

  const { id } = await params;
  const { searchParams } = new URL(req.url);

  try {
    const rendered = await buildMedicationCalendarPdf(
      authResult.ctx.orgId,
      id,
      searchParams.get('month'),
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
    return pdfResponse(rendered.buffer, rendered.fileName);
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('見つかりません')) {
      return notFound(cause.message);
    }

    return error(
      'EXTERNAL_PDF_RENDER_FAILED',
      '服薬カレンダー PDF を生成できませんでした',
      500,
    );
  }
}
