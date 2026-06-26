import { NextRequest } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import { success, internalError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { todayUtcRange } from '@/lib/utils/date-boundary';
import {
  buildAttentionItems,
  buildDispenseSetSummary,
  buildProcessRemaining,
  buildStaffCapacity,
  buildVisitSlotSummary,
  countAuditWaiting,
  findVisitSlotShortage,
  minutesOfDayLocal,
  shiftTimeToMinutes,
  visitTimeToMinutes,
  type StaffMemberInput,
} from '@/lib/analytics/capacity';

/**
 * p0_45「キャパシティ・詰まり確認」: 今日あとどれだけ対応できるかを
 * KPI 4 枚(訪問枠 / 調剤・セット / スタッフ稼働 / 緊急余力)+
 * 行程ごとの残り + スタッフ別の負荷 + 今すぐ見るべきことで返す BFF。
 */

const authenticatedGET = withAuthContext(
  async (_req, ctx) => {
    const now = new Date();
    // scheduled_date / shift date(@db.Date)比較用: ローカル日付の UTC 深夜レンジ
    const todayRange = todayUtcRange(now);
    // updated_at(DateTime, 実時刻)比較用: 従来どおりローカル深夜
    const localTodayStart = new Date(now);
    localTodayStart.setHours(0, 0, 0, 0);

    const [
      cycleCounts,
      todaySchedules,
      dispenseOpenCount,
      dispenseCompletedTodayCount,
      setPlans,
      members,
      todayShifts,
    ] = await Promise.all([
      prisma.medicationCycle.groupBy({
        by: ['overall_status'],
        where: { org_id: ctx.orgId, overall_status: { notIn: ['cancelled'] } },
        _count: { id: true },
      }),
      prisma.visitSchedule.findMany({
        where: {
          org_id: ctx.orgId,
          scheduled_date: todayRange,
          schedule_status: { notIn: ['cancelled', 'rescheduled'] },
        },
        select: {
          schedule_status: true,
          pharmacist_id: true,
          time_window_start: true,
          time_window_end: true,
          facility_batch_id: true,
        },
      }),
      prisma.dispenseTask.count({
        where: { org_id: ctx.orgId, status: { in: ['pending', 'in_progress'] } },
      }),
      prisma.dispenseTask.count({
        where: { org_id: ctx.orgId, status: 'completed', updated_at: { gte: localTodayStart } },
      }),
      prisma.setPlan.findMany({
        where: { org_id: ctx.orgId },
        select: {
          audits: {
            orderBy: { audited_at: 'desc' },
            take: 1,
            select: { result: true },
          },
        },
      }),
      prisma.membership.findMany({
        where: { org_id: ctx.orgId, is_active: true, user: { is_active: true } },
        orderBy: { created_at: 'asc' },
        select: {
          user_id: true,
          role: true,
          user: { select: { name: true } },
        },
      }),
      prisma.pharmacistShift.findMany({
        where: { org_id: ctx.orgId, date: todayRange },
        select: {
          user_id: true,
          available: true,
          available_from: true,
          available_to: true,
        },
      }),
    ]);

    const statusCounts: Record<string, number> = {};
    for (const row of cycleCounts) {
      statusCounts[row.overall_status] = row._count.id;
    }

    // メンバー入力(シフト + 残り予定の拘束)を組み立てて余白系 KPI を計算
    const shiftByUser = new Map(todayShifts.map((shift) => [shift.user_id, shift]));
    const memberInputs: StaffMemberInput[] = members.map((member) => {
      const shift = shiftByUser.get(member.user_id) ?? null;
      return {
        userId: member.user_id,
        name: member.user.name,
        role: member.role,
        shift: shift
          ? {
              available: shift.available,
              fromMinutes: shiftTimeToMinutes(shift.available_from),
              toMinutes: shiftTimeToMinutes(shift.available_to),
            }
          : null,
        visits: todaySchedules
          .filter(
            (schedule) =>
              schedule.pharmacist_id === member.user_id && schedule.schedule_status !== 'completed',
          )
          .map((schedule) => ({
            startMinutes: visitTimeToMinutes(schedule.time_window_start),
            endMinutes: visitTimeToMinutes(schedule.time_window_end),
          })),
      };
    });

    const nowMinutes = minutesOfDayLocal(now);
    const staffCapacity = buildStaffCapacity(memberInputs, nowMinutes);
    const processRemaining = buildProcessRemaining(statusCounts);
    const visitSlots = buildVisitSlotSummary(
      todaySchedules.map((schedule) => schedule.schedule_status),
    );
    const dispenseSet = buildDispenseSetSummary({
      dispenseOpenCount,
      dispenseCompletedTodayCount,
      setPlans: setPlans.map((plan) => ({
        latestAuditResult: plan.audits[0]?.result ?? null,
      })),
    });
    const visitShortage = findVisitSlotShortage(
      todaySchedules.map((schedule) => ({
        startMinutes: visitTimeToMinutes(schedule.time_window_start),
        endMinutes: visitTimeToMinutes(schedule.time_window_end),
        facilityBatchId: schedule.facility_batch_id,
      })),
      staffCapacity.workingPharmacistCount,
    );

    return success({
      data: {
        generated_at: now.toISOString(),
        kpis: {
          visit_slots: visitSlots,
          dispense_set: dispenseSet,
          staff_utilization_percent: staffCapacity.utilizationPercent,
          emergency_capacity_count: staffCapacity.emergencyCapacityCount,
        },
        process_remaining: processRemaining,
        staff_load: staffCapacity.staffLoad.map((item) => ({
          user_id: item.userId,
          label: item.label,
          load_percent: item.loadPercent,
        })),
        attention_items: buildAttentionItems({
          processRemaining,
          auditWaitingCount: countAuditWaiting(statusCounts),
          visitShortage,
          emergencyCapacityCount: staffCapacity.emergencyCapacityCount,
          workingStaffCount: staffCapacity.workingStaffCount,
        }),
      },
    });
  },
  {
    permission: 'canAdmin',
    message: 'キャパシティの閲覧権限がありません',
  },
);

export async function GET(
  req: NextRequest,
  routeContext: { params: Promise<Record<string, string>> },
) {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch {
    return withSensitiveNoStore(internalError());
  }
}
