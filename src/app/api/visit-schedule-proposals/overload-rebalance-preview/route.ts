import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { internalError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { withOrgContext } from '@/lib/db/rls';
import { visitScheduleDateKeySchema } from '@/lib/validations/visit-schedule';
import {
  previewVisitScheduleOverloadRebalance,
  toVisitScheduleOverloadRebalanceApiPreview,
  type OverloadRebalancerDb,
} from '@/server/services/visit-schedule-overload-rebalancer';

const MAX_PREVIEW_RANGE_DAYS = 30;
const dateKeySchema = visitScheduleDateKeySchema('日付形式が不正です（YYYY-MM-DD）');

const overloadPreviewSchema = z.object({
  date_from: dateKeySchema,
  date_to: dateKeySchema,
  search_start_date: dateKeySchema.optional(),
});

function toUtcDate(dateKey: string) {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

function diffUtcDays(from: Date, to: Date) {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

const authenticatedPOST = withAuthContext(
  async (req: NextRequest, ctx: AuthContext) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = overloadPreviewSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const dateFrom = toUtcDate(parsed.data.date_from);
    const dateTo = toUtcDate(parsed.data.date_to);
    const rangeDays = diffUtcDays(dateFrom, dateTo);
    if (rangeDays < 0) {
      return validationError('date_to は date_from 以降の日付を指定してください', {
        date_to: ['date_to は date_from 以降の日付を指定してください'],
      });
    }
    if (rangeDays > MAX_PREVIEW_RANGE_DAYS) {
      return validationError('過密前倒しプレビューの対象期間が長すぎます', {
        date_to: [`対象期間は最大 ${MAX_PREVIEW_RANGE_DAYS + 1} 日です`],
      });
    }

    const result = await withOrgContext(
      ctx.orgId,
      (tx) =>
        previewVisitScheduleOverloadRebalance({
          orgId: ctx.orgId,
          dateFrom,
          dateTo,
          searchStartDate: parsed.data.search_start_date
            ? toUtcDate(parsed.data.search_start_date)
            : undefined,
          db: tx as OverloadRebalancerDb,
        }),
      { requestContext: ctx },
    );

    return success({ data: toVisitScheduleOverloadRebalanceApiPreview(result) });
  },
  {
    permission: 'canVisit',
    message: '訪問候補の過密前倒しプレビュー権限がありません',
  },
);

export const POST: typeof authenticatedPOST = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedPOST(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};
