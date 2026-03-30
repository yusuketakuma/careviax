import { z } from 'zod';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success, validationError } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { queueOverdueReportResponseReminders } from '@/server/services/report-reminders';

const createReminderSchema = z.object({
  overdue_days: z.number().int().min(1).max(90).optional(),
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => ({}));
  const parsed = createReminderSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const result = await withOrgContext(req.orgId, (tx) =>
    queueOverdueReportResponseReminders(tx, req.orgId, {
      overdueDays: parsed.data.overdue_days,
    })
  );

  return success({ data: result }, 201);
}, {
  permission: 'canReport',
  message: '報告書リマインドの作成権限がありません',
});
