import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import { success, validationError } from '@/lib/api/response';
import { getCareReportDeliveryAnalytics } from '@/server/services/report-reminders';

const querySchema = z.object({
  overdue_days: z.coerce.number().int().min(1).max(90).optional(),
});

export async function GET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canReport',
    message: '報告書分析の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse({
    overdue_days: searchParams.get('overdue_days') ?? undefined,
  });
  if (!parsed.success) {
    return validationError('クエリパラメータが不正です', parsed.error.flatten().fieldErrors);
  }

  const analytics = await getCareReportDeliveryAnalytics(ctx.orgId, {
    overdueDays: parsed.data.overdue_days,
  });

  return success({ data: analytics });
}
