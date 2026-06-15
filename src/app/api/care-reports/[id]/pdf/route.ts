import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { conflict, error, notFound, validationError } from '@/lib/api/response';
import { pdfResponse } from '@/lib/api/pdf-response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { prisma } from '@/lib/db/client';
import { recordDataExportAudit } from '@/server/services/export-audit';
import { buildCareReportPdf } from '@/server/services/pdf-documents';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canReport',
    message: '報告書 PDF の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('報告書IDが不正です');

  try {
    const rendered = await buildCareReportPdf(authResult.ctx.orgId, id, {
      userId: authResult.ctx.userId,
      role: authResult.ctx.role,
    });
    await recordDataExportAudit(prisma, {
      orgId: authResult.ctx.orgId,
      actorId: authResult.ctx.userId,
      targetType: 'care_report',
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
    if (cause instanceof Error && cause.message === 'CARE_REPORT_NOT_CONFIRMED') {
      return conflict('薬剤師確認済みの報告書のみPDF出力できます');
    }

    return error('EXTERNAL_PDF_RENDER_FAILED', '報告書 PDF を生成できませんでした', 500);
  }
}
