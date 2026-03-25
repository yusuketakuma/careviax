import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [
    totalVisits,
    completedVisits,
    inPreparationVisits,
    readyVisits,
    cancelledVisits,
  ] = await Promise.all([
    prisma.visitSchedule.count({
      where: {
        org_id: req.orgId,
        scheduled_date: { gte: today, lt: tomorrow },
        schedule_status: { notIn: ['cancelled'] },
      },
    }),
    prisma.visitSchedule.count({
      where: {
        org_id: req.orgId,
        scheduled_date: { gte: today, lt: tomorrow },
        schedule_status: 'completed',
      },
    }),
    prisma.visitSchedule.count({
      where: {
        org_id: req.orgId,
        scheduled_date: { gte: today, lt: tomorrow },
        schedule_status: 'in_preparation',
      },
    }),
    prisma.visitSchedule.count({
      where: {
        org_id: req.orgId,
        scheduled_date: { gte: today, lt: tomorrow },
        schedule_status: 'ready',
      },
    }),
    prisma.visitSchedule.count({
      where: {
        org_id: req.orgId,
        scheduled_date: { gte: today, lt: tomorrow },
        schedule_status: 'cancelled',
      },
    }),
  ]);

  const pendingVisits = totalVisits - completedVisits;

  return success({
    visits: {
      total: totalVisits,
      completed: completedVisits,
      pending: pendingVisits,
      in_preparation: inPreparationVisits,
      ready: readyVisits,
      cancelled: cancelledVisits,
    },
  });
});
