import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { success, validationError } from '@/lib/api/response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { withOrgContext } from '@/lib/db/rls';
import { queueOverdueReportResponseReminders } from '@/server/services/report-reminders';

const createReminderSchema = z.object({
  overdue_days: z.number().int().min(1).max(90).optional(),
});

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createReminderSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const result = await withOrgContext(ctx.orgId, (tx) =>
      queueOverdueReportResponseReminders(tx, ctx.orgId, {
        overdueDays: parsed.data.overdue_days,
      }),
    );

    return success({ data: result }, 201);
  },
  {
    permission: 'canSendCareReport',
    message: '報告書リマインドの作成権限がありません',
  },
);
