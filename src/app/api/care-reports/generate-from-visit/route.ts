import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success, validationError, notFound } from '@/lib/api/response';
import { generateReportsFromVisit } from '@/server/services/report-generator';
import { z } from 'zod';

const generateFromVisitSchema = z.object({
  visit_record_id: z.string().min(1, '訪問記録IDは必須です'),
  report_type: z.enum(['physician_report', 'care_manager_report']).optional(),
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = generateFromVisitSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { visit_record_id, report_type } = parsed.data;

  let result: { reports: Array<{ id: string; report_type: string }> };
  try {
    result = await generateReportsFromVisit(
      req.orgId,
      req.userId,
      visit_record_id,
      report_type
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('not found')) {
      return notFound(message);
    }
    throw err;
  }

  return success({ data: result.reports }, 201);
});
