import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { error, notFound } from '@/lib/api/response';
import { pdfResponse } from '@/lib/api/pdf-response';
import { prisma } from '@/lib/db/client';
import { recordDataExportAudit } from '@/server/services/export-audit';
import { buildMedicationHistoryPdf } from '@/server/services/pdf-documents';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '薬歴 PDF の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;

  const { id } = await params;

  try {
    const rendered = await buildMedicationHistoryPdf(authResult.ctx.orgId, id);
    await recordDataExportAudit(prisma, {
      orgId: authResult.ctx.orgId,
      actorId: authResult.ctx.userId,
      targetType: 'medication_history',
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

    return error('EXTERNAL_PDF_RENDER_FAILED', '薬歴 PDF を生成できませんでした', 500);
  }
}
