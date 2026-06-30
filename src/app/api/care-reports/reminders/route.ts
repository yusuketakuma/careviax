import { z } from 'zod';
import { unstable_rethrow } from 'next/navigation';
import { withAuthContext } from '@/lib/auth/context';
import { internalError, success, validationError } from '@/lib/api/response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withOrgContext } from '@/lib/db/rls';
import { queueOverdueReportResponseReminders } from '@/server/services/report-reminders';

const createReminderSchema = z.object({
  overdue_days: z.number().int().min(1).max(90).optional(),
  delivery_ids: z.array(z.string().trim().min(1).max(191)).max(50).optional(),
  snooze_until: z.string().datetime().optional(),
});

const authenticatedPOST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createReminderSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }
    if (parsed.data.snooze_until && !parsed.data.delivery_ids?.length) {
      return validationError('snooze_until を指定する場合は delivery_ids が必要です', {
        delivery_ids: ['delivery_ids を指定してください'],
      });
    }
    const snoozeUntil = parsed.data.snooze_until ? new Date(parsed.data.snooze_until) : null;
    if (snoozeUntil && snoozeUntil <= new Date()) {
      return validationError('snooze_until は未来日時を指定してください', {
        snooze_until: ['未来日時を指定してください'],
      });
    }

    const result = await withOrgContext(
      ctx.orgId,
      (tx) =>
        queueOverdueReportResponseReminders(tx, ctx.orgId, {
          overdueDays: parsed.data.overdue_days,
          deliveryIds: parsed.data.delivery_ids,
          snoozeUntil,
        }),
      { requestContext: ctx },
    );

    return success({ data: result }, 201);
  },
  {
    permission: 'canSendCareReport',
    message: '報告書リマインドの作成権限がありません',
  },
);

export const POST: typeof authenticatedPOST = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedPOST(req, routeContext));
  } catch (error) {
    unstable_rethrow(error);
    return withSensitiveNoStore(internalError());
  }
};
