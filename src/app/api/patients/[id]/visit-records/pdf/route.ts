import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import { error, notFound, validationError } from '@/lib/api/response';
import { pdfResponse } from '@/lib/api/pdf-response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { dateKeySchema } from '@/lib/validations/date-key';
import { recordDataExportAudit } from '@/server/services/export-audit';
import { buildPatientVisitRecordsPdf } from '@/server/services/pdf-documents';

export const runtime = 'nodejs';

const visitRecordsPdfQuerySchema = z
  .object({
    date_from: dateKeySchema('日付形式が不正です（YYYY-MM-DD）').optional(),
    date_to: dateKeySchema('日付形式が不正です（YYYY-MM-DD）').optional(),
  })
  .refine((value) => !value.date_from || !value.date_to || value.date_to >= value.date_from, {
    path: ['date_to'],
    message: 'date_to は date_from 以降を指定してください',
  });

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問記録一覧 PDF の閲覧権限がありません',
  });
  if ('response' in authResult) return withSensitiveNoStore(authResult.response);

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return withSensitiveNoStore(validationError('患者IDが不正です'));

  const url = new URL(req.url);
  const parsedQuery = visitRecordsPdfQuerySchema.safeParse({
    ...(url.searchParams.has('date_from') ? { date_from: url.searchParams.get('date_from') } : {}),
    ...(url.searchParams.has('date_to') ? { date_to: url.searchParams.get('date_to') } : {}),
  });
  if (!parsedQuery.success) {
    return withSensitiveNoStore(
      validationError('検索条件が不正です', parsedQuery.error.flatten().fieldErrors),
    );
  }
  const { date_from: dateFrom, date_to: dateTo } = parsedQuery.data;

  try {
    const rendered = await buildPatientVisitRecordsPdf(authResult.ctx.orgId, id, dateFrom, dateTo, {
      userId: authResult.ctx.userId,
      role: authResult.ctx.role,
    });
    await recordDataExportAudit(prisma, {
      orgId: authResult.ctx.orgId,
      actorId: authResult.ctx.userId,
      targetType: 'visit_record_list',
      targetId: id,
      format: 'pdf',
      recordCount: 1,
      filters: {
        date_from: dateFrom ?? null,
        date_to: dateTo ?? null,
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
      error('EXTERNAL_PDF_RENDER_FAILED', '訪問記録一覧 PDF を生成できませんでした', 500),
    );
  }
}
