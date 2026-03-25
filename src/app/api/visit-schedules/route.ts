import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { createVisitScheduleSchema } from '@/lib/validations/visit-schedule';
import { prisma } from '@/lib/db/client';

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const { cursor, limit } = parsePaginationParams(searchParams);

  const dateFrom = searchParams.get('date_from');
  const dateTo = searchParams.get('date_to');
  const pharmacistId = searchParams.get('pharmacist_id');
  const caseId = searchParams.get('case_id');

  const where = {
    org_id: req.orgId,
    ...(dateFrom || dateTo
      ? {
          scheduled_date: {
            ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
            ...(dateTo ? { lte: new Date(dateTo) } : {}),
          },
        }
      : {}),
    ...(pharmacistId ? { pharmacist_id: pharmacistId } : {}),
    ...(caseId ? { case_id: caseId } : {}),
  };

  const schedules = await prisma.visitSchedule.findMany({
    where,
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: [{ scheduled_date: 'asc' }, { time_window_start: 'asc' }],
    include: {
      visit_record: { select: { id: true, outcome_status: true } },
      preparation: { select: { id: true, prepared_at: true } },
    },
  });

  const hasMore = schedules.length > limit;
  const data = hasMore ? schedules.slice(0, limit) : schedules;
  const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

  return success({ data, hasMore, nextCursor });
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createVisitScheduleSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { scheduled_date, time_window_start, time_window_end, ...rest } = parsed.data;

  const schedule = await withOrgContext(req.orgId, async (tx) => {
    return tx.visitSchedule.create({
      data: {
        org_id: req.orgId,
        scheduled_date: new Date(scheduled_date),
        ...(time_window_start ? { time_window_start: new Date(`1970-01-01T${time_window_start}`) } : {}),
        ...(time_window_end ? { time_window_end: new Date(`1970-01-01T${time_window_end}`) } : {}),
        ...rest,
      },
    });
  });

  return success(schedule, 201);
});
