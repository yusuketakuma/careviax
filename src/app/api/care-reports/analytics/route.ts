import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import { internalError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { optionalBoundedIntegerSearchParam } from '@/lib/api/validation';
import { withOrgContext } from '@/lib/db/rls';
import { getCareReportDeliveryAnalytics } from '@/server/services/report-reminders';

const querySchema = z.object({
  overdue_days: optionalBoundedIntegerSearchParam('overdue_days', 1, 90),
});

const careReportAnalyticsSingleValueQueryNames = [
  'overdue_days',
] as const satisfies readonly (keyof z.infer<typeof querySchema>)[];

function findInvalidCareReportAnalyticsQueryParams(searchParams: URLSearchParams) {
  const fieldErrors: Record<string, string[]> = {};

  for (const name of careReportAnalyticsSingleValueQueryNames) {
    if (searchParams.getAll(name).length > 1) {
      fieldErrors[name] = [`${name} は1つだけ指定してください`];
    }
  }

  const rawOverdueDays = searchParams.get('overdue_days');
  if (rawOverdueDays != null && rawOverdueDays !== rawOverdueDays.trim()) {
    fieldErrors.overdue_days = ['overdue_days は整数で指定してください'];
  }

  return Object.keys(fieldErrors).length > 0 ? fieldErrors : null;
}

async function authenticatedGET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canSendCareReport',
    message: '報告書分析の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { searchParams } = new URL(req.url);
  const invalidQueryParams = findInvalidCareReportAnalyticsQueryParams(searchParams);
  if (invalidQueryParams) {
    return validationError('クエリパラメータが不正です', invalidQueryParams);
  }

  const parsed = querySchema.safeParse({
    overdue_days: searchParams.get('overdue_days') ?? undefined,
  });
  if (!parsed.success) {
    return validationError('クエリパラメータが不正です', parsed.error.flatten().fieldErrors);
  }

  const analytics = await withOrgContext(
    ctx.orgId,
    (tx) =>
      getCareReportDeliveryAnalytics(
        ctx.orgId,
        {
          overdueDays: parsed.data.overdue_days,
        },
        tx,
      ),
    { requestContext: ctx },
  );

  return success({ data: analytics });
}

export async function GET(req: NextRequest) {
  try {
    return withSensitiveNoStore(await authenticatedGET(req));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
}
