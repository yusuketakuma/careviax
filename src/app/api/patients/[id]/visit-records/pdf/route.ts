import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuthContext, type AuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { notFound, registeredError, validationError } from '@/lib/api/response';
import { pdfResponse } from '@/lib/api/pdf-response';
import { prisma } from '@/lib/db/client';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { dateKeySchema } from '@/lib/validations/date-key';
import { recordDataExportAudit } from '@/server/services/export-audit';
import { buildPatientVisitRecordsPdf } from '@/server/services/pdf-documents';
import { PdfNotFoundError } from '@/server/services/pdf-errors';

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

async function patientVisitRecordsPdfGET(
  req: NextRequest,
  ctx: AuthContext,
  { params }: AuthRouteContext<{ id: string }>,
) {
  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');

  const url = new URL(req.url);
  const parsedQuery = visitRecordsPdfQuerySchema.safeParse({
    ...(url.searchParams.has('date_from') ? { date_from: url.searchParams.get('date_from') } : {}),
    ...(url.searchParams.has('date_to') ? { date_to: url.searchParams.get('date_to') } : {}),
  });
  if (!parsedQuery.success) {
    return validationError('検索条件が不正です', parsedQuery.error.flatten().fieldErrors);
  }
  const { date_from: dateFrom, date_to: dateTo } = parsedQuery.data;

  let rendered: Awaited<ReturnType<typeof buildPatientVisitRecordsPdf>>;
  try {
    rendered = await buildPatientVisitRecordsPdf(ctx.orgId, id, dateFrom, dateTo, {
      userId: ctx.userId,
      role: ctx.role,
    });
  } catch (cause) {
    unstable_rethrow(cause);
    if (cause instanceof PdfNotFoundError) {
      return notFound(cause.message);
    }

    return registeredError('EXTERNAL_PDF_RENDER_FAILED', '訪問記録一覧 PDF を生成できませんでした');
  }

  try {
    await recordDataExportAudit(prisma, {
      orgId: ctx.orgId,
      actorId: ctx.userId,
      targetType: 'visit_record_list',
      targetId: id,
      format: 'pdf',
      recordCount: 1,
      filters: {
        date_from: dateFrom ?? null,
        date_to: dateTo ?? null,
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      correlationId: ctx.correlationId,
    });
  } catch {
    return registeredError(
      'VISIT_RECORD_LIST_PDF_EXPORT_AUDIT_FAILED',
      '訪問記録一覧 PDF 出力監査を記録できませんでした',
    );
  }

  return pdfResponse(rendered.buffer, rendered.fileName);
}

export const GET = withAuthContext<{ id: string }, Response>(patientVisitRecordsPdfGET, {
  permission: 'canVisit',
  message: '訪問記録一覧 PDF の閲覧権限がありません',
});
