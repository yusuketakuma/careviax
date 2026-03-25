import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const withinDays = parseInt(searchParams.get('within_days') ?? '7', 10);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const deadline = new Date(today);
  deadline.setDate(deadline.getDate() + withinDays);

  // Find visit schedules with medication_end_date approaching
  const schedules = await prisma.visitSchedule.findMany({
    where: {
      org_id: req.orgId,
      medication_end_date: {
        gte: today,
        lte: deadline,
      },
      schedule_status: { notIn: ['cancelled', 'completed'] },
    },
    orderBy: { medication_end_date: 'asc' },
    select: {
      id: true,
      case_id: true,
      scheduled_date: true,
      medication_end_date: true,
      visit_type: true,
      pharmacist_id: true,
    },
  });

  // Group by urgency (3 days / 7 days)
  const threeDays = new Date(today);
  threeDays.setDate(threeDays.getDate() + 3);

  const critical = schedules.filter(
    (s) => s.medication_end_date && s.medication_end_date <= threeDays
  );
  const warning = schedules.filter(
    (s) => s.medication_end_date && s.medication_end_date > threeDays
  );

  return success({
    total: schedules.length,
    critical: { count: critical.length, items: critical },
    warning: { count: warning.length, items: warning },
  });
});
