import { z } from 'zod';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success, validationError } from '@/lib/api/response';
import { parseSearchParams } from '@/lib/api/validation';
import { createVisitScheduleSchema } from '@/lib/validations/visit-schedule';
import { prisma } from '@/lib/db/client';
import { createSchedule, listSchedules } from '@/server/services/visit-schedule-service';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';

const optionalDateParam = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), '日付形式が不正です')
  .optional();

const visitScheduleQuerySchema = z.object({
  cursor: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  date_from: optionalDateParam,
  date_to: optionalDateParam,
  pharmacist_id: z.string().trim().optional(),
  case_id: z.string().trim().optional(),
  patient_id: z.string().trim().optional(),
  sort: z.enum(['scheduled_date', 'time_window_start', 'priority', 'created_at']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const parsed = parseSearchParams(visitScheduleQuerySchema, searchParams);
  if (!parsed.ok) {
    return validationError('クエリパラメータが不正です', parsed.error.flatten().fieldErrors);
  }
  const result = await listSchedules(prisma, req.orgId, parsed.data);
  return success(result);
}, {
  permission: 'canVisit',
  message: '訪問予定の閲覧権限がありません',
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createVisitScheduleSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }
  if (parsed.data.notes?.trim()) {
    return validationError('訪問予定メモはまだ保存できません');
  }

  const result = await createSchedule(prisma, req.orgId, req.userId, parsed.data);
  if (result instanceof Response) return result;

  await notifyWorkflowMutation({
    orgId: req.orgId,
    payload: { source: 'visit_schedules_create', case_id: parsed.data.case_id },
  });

  return success(result, 201);
}, {
  permission: 'canVisit',
  message: '訪問予定の作成権限がありません',
});
