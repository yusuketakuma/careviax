import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { error, notFound } from '@/lib/api/response';
import { pdfResponse } from '@/lib/api/pdf-response';
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
