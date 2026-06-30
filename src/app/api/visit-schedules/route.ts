import { z } from 'zod';
import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { internalError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { optionalBoundedIntegerSearchParam, parseSearchParams } from '@/lib/api/validation';
import {
  createVisitScheduleSchema,
  visitScheduleDateKeySchema,
} from '@/lib/validations/visit-schedule';
import { prisma } from '@/lib/db/client';
import { createSchedule, listSchedules } from '@/server/services/visit-schedule-service';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';

const optionalDateParam = visitScheduleDateKeySchema('日付形式が不正です（YYYY-MM-DD）').optional();

const visitScheduleQuerySchema = z.object({
  cursor: z.string().trim().optional(),
  limit: optionalBoundedIntegerSearchParam('limit', 1, 100),
  date_from: optionalDateParam,
  date_to: optionalDateParam,
  status_scope: z.enum(['active']).optional(),
  pharmacist_id: z.string().trim().optional(),
  case_id: z.string().trim().optional(),
  patient_id: z.string().trim().optional(),
  sort: z.enum(['scheduled_date', 'time_window_start', 'priority', 'created_at']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

const authenticatedGET = withAuthContext(
  async (req: NextRequest, ctx: AuthContext) => {
    const { searchParams } = new URL(req.url);
    const parsed = parseSearchParams(visitScheduleQuerySchema, searchParams);
    if (!parsed.ok) {
      return validationError('クエリパラメータが不正です', parsed.error.flatten().fieldErrors);
    }
    const result = await listSchedules(prisma, ctx.orgId, parsed.data, ctx);
    return success(result);
  },
  {
    permission: 'canVisit',
    message: '訪問予定の閲覧権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};

const authenticatedPOST = withAuthContext(
  async (req: NextRequest, ctx: AuthContext) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createVisitScheduleSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }
    if (parsed.data.notes?.trim()) {
      return validationError('訪問予定メモはまだ保存できません');
    }

    const result = await createSchedule(prisma, ctx.orgId, ctx.userId, parsed.data, {
      userId: ctx.userId,
      role: ctx.role,
    });
    if (result instanceof Response) return result;

    await notifyWorkflowMutation({
      orgId: ctx.orgId,
      payload: { source: 'visit_schedules_create', case_id: parsed.data.case_id },
    });

    return success(result, 201);
  },
  {
    permission: 'canVisit',
    message: '訪問予定の作成権限がありません',
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
