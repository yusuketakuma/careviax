import { auth } from '@/lib/auth/config';
import { prisma } from '@/lib/db/client';
import { resolveLocalUserByIdentity } from '@/lib/auth/user-resolution';
import { success, unauthorized } from '@/lib/api/response';
import {
  japanDateKey,
  japanMonthInstantRange,
  todayUtcRange,
  utcMonthDateRange,
} from '@/lib/utils/date-boundary';

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
  const currentMonthKey = japanDateKey(now).slice(0, 7);
  const visitMonthRange = japanMonthInstantRange(currentMonthKey);
  const scheduleTodayRange = todayUtcRange(now);
  const scheduleMonthRange = utcMonthDateRange(currentMonthKey);

  const [currentMonthVisitCount, last30DaysVisitCount, todayAssignedCount, upcomingAssignedCount] =
    await Promise.all([
      prisma.visitRecord.count({
        where: {
          pharmacist_id: userId,
          visit_date: visitMonthRange,
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
          scheduled_date: scheduleTodayRange,
          schedule_status: {
            in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress'],
          },
        },
      }),
      prisma.visitSchedule.count({
        where: {
          pharmacist_id: userId,
          scheduled_date: {
            gte: scheduleTodayRange.lt,
            lt: scheduleMonthRange.lt,
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
