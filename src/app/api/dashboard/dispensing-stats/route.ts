import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { subDays, startOfDay, endOfDay, format } from 'date-fns';

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  const [pendingTasks, completedWithNoAudit, completedToday] = await Promise.all([
    // status='pending' のDispenseTask数
    prisma.dispenseTask.count({
      where: {
        org_id: req.orgId,
        status: 'pending',
      },
    }),

    // status='completed' かつ auditsが0件のタスク数（鑑査待ち）
    prisma.dispenseTask.count({
      where: {
        org_id: req.orgId,
        status: 'completed',
        audits: { none: {} },
      },
    }),

    // 本日 completed に遷移（updated_at が今日かつ status='completed'）
    prisma.dispenseTask.count({
      where: {
        org_id: req.orgId,
        status: 'completed',
        updated_at: { gte: todayStart, lte: todayEnd },
      },
    }),
  ]);

  // 直近7日の日別完了数
  const sevenDaysAgo = startOfDay(subDays(now, 6));
  const recentTasks = await prisma.dispenseTask.findMany({
    where: {
      org_id: req.orgId,
      status: 'completed',
      updated_at: { gte: sevenDaysAgo },
    },
    select: { updated_at: true },
  });

  // Group by date
  const countsByDate: Record<string, number> = {};
  for (let i = 6; i >= 0; i--) {
    const d = subDays(now, i);
    countsByDate[format(d, 'yyyy-MM-dd')] = 0;
  }
  for (const task of recentTasks) {
    const dateKey = format(task.updated_at, 'yyyy-MM-dd');
    if (dateKey in countsByDate) {
      countsByDate[dateKey]++;
    }
  }

  const completedLast7Days = Object.entries(countsByDate).map(([date, count]) => ({
    date,
    count,
  }));

  return success({
    pendingTasks,
    auditPendingTasks: completedWithNoAudit,
    completedToday,
    completedLast7Days,
  });
}, {
  permission: 'canViewDashboard',
  message: 'ダッシュボードの閲覧権限がありません',
});
