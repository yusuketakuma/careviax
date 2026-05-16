import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { ACTIVE_VISIT_SCHEDULE_STATUSES } from '@/lib/constants/visit';
import { buildVisitScheduleAssignmentWhere } from '@/lib/auth/visit-schedule-access';

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    const { searchParams } = new URL(req.url);
    const pharmacistId = searchParams.get('pharmacist_id');
    const assignmentWhere = buildVisitScheduleAssignmentWhere(req);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const schedules = await prisma.visitSchedule.findMany({
      where: {
        org_id: req.orgId,
        scheduled_date: {
          gte: today,
          lt: tomorrow,
        },
        schedule_status: {
          in: [...ACTIVE_VISIT_SCHEDULE_STATUSES],
        },
        ...(pharmacistId ? { pharmacist_id: pharmacistId } : {}),
        ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
      },
      orderBy: [{ route_order: 'asc' }, { time_window_start: 'asc' }],
      include: {
        visit_record: { select: { id: true, outcome_status: true } },
        preparation: { select: { id: true, prepared_at: true, carry_items_confirmed: true } },
        override_request: {
          select: {
            id: true,
            status: true,
            requested_at: true,
            approved_at: true,
            impact_summary: true,
          },
        },
      },
    });

    return success({ data: schedules });
  },
  {
    permission: 'canVisit',
    message: '本日の訪問予定の閲覧権限がありません',
  },
);
