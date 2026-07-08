import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { internalError, success } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { japanDayInstantRange } from '@/lib/utils/date-boundary';
import { logger } from '@/lib/utils/logger';
import { withRoutePerformance } from '@/lib/utils/performance';

const ROUTE = '/api/dashboard/dispensing-stats';

async function authenticatedGET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canViewDashboard',
    message: 'ダッシュボードの閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
    const now = new Date();
    const todayRange = japanDayInstantRange(now);

    const [
      pendingTasks,
      completedWithNoAudit,
      completedToday,
      prescriptionRegisteredWithoutDispenseTasks,
    ] = await Promise.all([
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
          updated_at: todayRange,
        },
      }),

      // 処方登録済みで調剤工程に入っているのに DispenseTask が無い連動漏れ
      prisma.medicationCycle.count({
        where: {
          org_id: ctx.orgId,
          overall_status: { in: ['ready_to_dispense', 'dispensing'] },
          prescription_intakes: { some: {} },
          dispense_tasks: { none: {} },
        },
      }),
    ]);

    return success({
      data: {
        pendingTasks,
        auditPendingTasks: completedWithNoAudit,
        completedToday,
        prescriptionRegisteredWithoutDispenseTasks,
      },
    });
  });
}

export async function GET(req: NextRequest, routeContext?: unknown) {
  void routeContext;
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedGET(req));
    } catch (err) {
      unstable_rethrow(err);
      logger.error(
        {
          event: 'dashboard_dispensing_stats_unhandled_error',
          route: ROUTE,
          method: 'GET',
          status: 500,
        },
        err,
      );
      return withSensitiveNoStore(internalError());
    }
  });
}
