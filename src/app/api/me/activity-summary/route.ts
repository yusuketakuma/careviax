import { auth } from '@/lib/auth/config';
import { prisma } from '@/lib/db/client';
import { resolveLocalUserByIdentity } from '@/lib/auth/user-resolution';
import { success, unauthorized } from '@/lib/api/response';

function getMonthRange(baseDate: Date) {
  const monthStart = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
  const monthEnd = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 1);
  return { monthStart, monthEnd };
}

function getTodayRange(baseDate: Date) {
  const dayStart = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  const dayEnd = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + 1);
  return { dayStart, dayEnd };
}

export async function GET() {
  const session = await auth();
  const userId =
    session?.user?.id ??
    (
      await resolveLocalUserByIdentity({
        cognitoSub: session?.user?.cognitoSub,
        email: session?.user?.email,
      })
    )?.id;

  if (!userId) {
    return unauthorized();
  }

  const now = new Date();
  const { monthStart, monthEnd } = getMonthRange(now);
  const { dayStart, dayEnd } = getTodayRange(now);

  const [currentMonthVisitCount, last30DaysVisitCount, todayAssignedCount, upcomingAssignedCount] =
    await Promise.all([
      prisma.visitRecord.count({
        where: {
          pharmacist_id: userId,
          visit_date: {
            gte: monthStart,
            lt: monthEnd,
          },
        },
      }),
      prisma.visitRecord.count({
        where: {
          pharmacist_id: userId,
          visit_date: {
            gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
            lt: now,
          },
        },
      }),
      prisma.visitSchedule.count({
        where: {
          pharmacist_id: userId,
          scheduled_date: {
            gte: dayStart,
            lt: dayEnd,
          },
          schedule_status: {
            in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress'],
          },
        },
      }),
      prisma.visitSchedule.count({
        where: {
          pharmacist_id: userId,
          scheduled_date: {
            gte: dayEnd,
            lt: monthEnd,
          },
          schedule_status: {
            in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress'],
          },
        },
      }),
    ]);

  return success({
    data: {
      currentMonthVisitCount,
      last30DaysVisitCount,
      todayAssignedCount,
      upcomingAssignedCount,
    },
  });
}
