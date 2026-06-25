import { withAuthContext } from '@/lib/auth/context';
import { success } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { startOfDay, endOfDay } from 'date-fns';

const authenticatedGET = withAuthContext(
  async (_req, ctx) => {
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);

    const [pendingTasks, completedWithNoAudit, completedToday] = await Promise.all([
      // status='pending' のDispenseTask数
      prisma.dispenseTask.count({
        where: {
          org_id: ctx.orgId,
          status: 'pending',
        },
      }),

      // status='completed' かつ auditsが0件のタスク数（鑑査待ち）
      prisma.dispenseTask.count({
        where: {
          org_id: ctx.orgId,
          status: 'completed',
          audits: { none: {} },
        },
      }),

      // 本日 completed に遷移（updated_at が今日かつ status='completed'）
      prisma.dispenseTask.count({
        where: {
          org_id: ctx.orgId,
          status: 'completed',
          updated_at: { gte: todayStart, lte: todayEnd },
        },
      }),
    ]);

    return success({
      pendingTasks,
      auditPendingTasks: completedWithNoAudit,
      completedToday,
    });
  },
  {
    permission: 'canViewDashboard',
    message: 'ダッシュボードの閲覧権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) =>
  withSensitiveNoStore(await authenticatedGET(req, routeContext));
