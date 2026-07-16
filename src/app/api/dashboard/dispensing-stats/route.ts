import { NextRequest } from 'next/server';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { success } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { japanDayInstantRange } from '@/lib/utils/date-boundary';

async function dashboardDispensingStatsGET(_req: NextRequest, ctx: AuthContext) {
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
}

export const GET = withAuthContext(dashboardDispensingStatsGET, {
  permission: 'canViewDashboard',
  message: 'ダッシュボードの閲覧権限がありません',
});
