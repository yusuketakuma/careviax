import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { success, validationError } from '@/lib/api/response';
import { parseSearchParams } from '@/lib/api/validation';
import { prisma } from '@/lib/db/client';
import { visitScheduleDateKeySchema } from '@/lib/validations/visit-schedule';
import { addUtcDays, localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import type {
  DayBoardPendingProposal,
  DayBoardStaff,
  DayBoardVisit,
  ScheduleDayBoardResponse,
} from '@/types/schedule-day-board';

/**
 * new_03_schedule(今日のスケジュール — 全員)用 BFF。
 * 薬剤師・事務の担当者レーン(当日訪問+タスク件数)と未確定(受入判断)を
 * 1 リクエストで返す読み取り専用集計(docs/design-gap-analysis-new.md 03_schedule)。
 * 右レール(次にやること/止まっている理由)は /api/dashboard/cockpit を共用する。
 */

const STAFF_ROW_LIMIT = 6;
const PENDING_PROPOSAL_LIMIT = 3;
/** 余白試算: 勤務帯 9:00-18:00 から昼休みを除いた基準分 */
const WORKDAY_MINUTES = 9 * 60;
const LUNCH_MINUTES = 60;
const TRAVEL_MINUTES_PER_VISIT = 30;
const DEFAULT_VISIT_MINUTES = 60;

const BOARD_MEMBER_ROLES = ['owner', 'admin', 'pharmacist', 'pharmacist_trainee', 'clerk'] as const;
const VEHICLE_ASSIGNABLE_STATUSES = new Set([
  'planned',
  'in_preparation',
  'ready',
  'departed',
  'in_progress',
]);

const dayBoardQuerySchema = z.object({
  date: visitScheduleDateKeySchema('日付形式が不正です（YYYY-MM-DD）').optional(),
});

// 日付キー生成・@db.Date 比較は date-boundary ヘルパーに統一(JST 当日取りこぼし防止)

function minutesOfTimeValue(value: Date | null): number | null {
  if (!value) return null;
  return value.getHours() * 60 + value.getMinutes();
}

/** 訪問の占有分(時間未設定は既定 60 分)。 */
function visitOccupiedMinutes(start: Date | null, end: Date | null): number {
  const startMinutes = minutesOfTimeValue(start);
  const endMinutes = minutesOfTimeValue(end);
  if (startMinutes == null) return DEFAULT_VISIT_MINUTES;
  if (endMinutes == null || endMinutes <= startMinutes) return DEFAULT_VISIT_MINUTES;
  return endMinutes - startMinutes;
}

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const parsed = parseSearchParams(dayBoardQuerySchema, searchParams);
    if (!parsed.ok) {
      return validationError('クエリパラメータが不正です', parsed.error.flatten().fieldErrors);
    }

    const now = new Date();
    // scheduled_date(@db.Date)は UTC midnight 保存。ローカル解釈の Date を渡すと
    // Prisma が UTC 日付へ切り捨てて前日扱いになる(JST で当日全件こぼれる)ため、
    // ローカル日付キー → UTC midnight に正規化して比較する。
    const dateKey = parsed.data.date ?? localDateKey(now);
    const dayStart = utcDateFromLocalKey(dateKey);
    const dayEnd = addUtcDays(dayStart, 1);

    const [
      memberships,
      schedules,
      auditTaskGroups,
      openTaskGroups,
      reportPendingCount,
      unavailableShifts,
      vehicleResources,
      proposals,
    ] = await Promise.all([
      prisma.membership.findMany({
        where: {
          org_id: ctx.orgId,
          is_active: true,
          role: { in: [...BOARD_MEMBER_ROLES] },
        },
        orderBy: [{ user: { name_kana: 'asc' } }],
        select: {
          role: true,
          user: { select: { id: true, name: true } },
        },
      }),
      prisma.visitSchedule.findMany({
        where: {
          org_id: ctx.orgId,
          scheduled_date: { gte: dayStart, lt: dayEnd },
          schedule_status: { notIn: ['cancelled', 'rescheduled'] },
        },
        orderBy: [{ time_window_start: 'asc' }, { route_order: 'asc' }],
        select: {
          id: true,
          pharmacist_id: true,
          visit_type: true,
          schedule_status: true,
          priority: true,
          site_id: true,
          route_order: true,
          vehicle_resource_id: true,
          vehicle_resource: {
            select: {
              id: true,
              label: true,
              travel_mode: true,
            },
          },
          time_window_start: true,
          time_window_end: true,
          confirmed_at: true,
          facility_batch_id: true,
          facility_batch: { select: { id: true, facility_id: true } },
          case_: { select: { patient: { select: { name: true } } } },
        },
      }),
      prisma.dispenseTask.groupBy({
        by: ['assigned_to'],
        where: { org_id: ctx.orgId, status: 'completed' },
        _count: { id: true },
      }),
      prisma.task.groupBy({
        by: ['assigned_to'],
        where: { org_id: ctx.orgId, status: { in: ['pending', 'in_progress'] } },
        _count: { id: true },
      }),
      prisma.medicationCycle.count({
        where: { org_id: ctx.orgId, overall_status: 'visit_completed' },
      }),
      prisma.pharmacistShift.findMany({
        where: {
          org_id: ctx.orgId,
          date: { gte: dayStart, lt: dayEnd },
          available: false,
        },
        select: { user_id: true },
      }),
      prisma.visitVehicleResource.findMany({
        where: {
          org_id: ctx.orgId,
        },
        orderBy: [{ available: 'desc' }, { label: 'asc' }],
        select: {
          id: true,
          label: true,
          site_id: true,
          vehicle_code: true,
          travel_mode: true,
          max_stops: true,
          available: true,
        },
      }),
      prisma.visitScheduleProposal.findMany({
        where: {
          org_id: ctx.orgId,
          proposal_status: { in: ['proposed', 'patient_contact_pending', 'reschedule_pending'] },
          proposed_date: { gte: dayStart },
        },
        orderBy: [{ proposed_date: 'asc' }, { time_window_start: 'asc' }],
        take: PENDING_PROPOSAL_LIMIT,
        select: {
          id: true,
          visit_type: true,
          proposal_status: true,
          proposed_date: true,
          time_window_start: true,
          time_window_end: true,
          proposed_pharmacist_id: true,
          case_: { select: { patient: { select: { name: true } } } },
        },
      }),
    ]);

    // 施設名(facility_batch.facility_id → Facility.name)
    const facilityIds = Array.from(
      new Set(
        schedules
          .map((schedule) => schedule.facility_batch?.facility_id)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    const facilities =
      facilityIds.length === 0
        ? []
        : await prisma.facility.findMany({
            where: { org_id: ctx.orgId, id: { in: facilityIds } },
            select: { id: true, name: true },
          });
    const facilityNameById = new Map(facilities.map((facility) => [facility.id, facility.name]));
    const batchPatientCounts = new Map<string, number>();
    for (const schedule of schedules) {
      if (!schedule.facility_batch_id) continue;
      batchPatientCounts.set(
        schedule.facility_batch_id,
        (batchPatientCounts.get(schedule.facility_batch_id) ?? 0) + 1,
      );
    }

    const auditCountByUser = new Map(
      auditTaskGroups
        .filter((group) => group.assigned_to)
        .map((group) => [group.assigned_to as string, group._count.id]),
    );
    const unassignedAuditCount =
      auditTaskGroups.find((group) => group.assigned_to == null)?._count.id ?? 0;
    const openTaskCountByUser = new Map(
      openTaskGroups
        .filter((group) => group.assigned_to)
        .map((group) => [group.assigned_to as string, group._count.id]),
    );

    const schedulesByPharmacist = new Map<string, typeof schedules>();
    for (const schedule of schedules) {
      const list = schedulesByPharmacist.get(schedule.pharmacist_id) ?? [];
      list.push(schedule);
      schedulesByPharmacist.set(schedule.pharmacist_id, list);
    }

    const toBoardVisit = (schedule: (typeof schedules)[number]): DayBoardVisit => ({
      id: schedule.id,
      patient_name: schedule.case_.patient.name,
      visit_type: schedule.visit_type,
      schedule_status: schedule.schedule_status,
      priority: schedule.priority,
      site_id: schedule.site_id,
      route_order: schedule.route_order,
      time_start: schedule.time_window_start?.toISOString() ?? null,
      time_end: schedule.time_window_end?.toISOString() ?? null,
      vehicle_resource_id: schedule.vehicle_resource_id,
      vehicle_label: schedule.vehicle_resource?.label ?? null,
      vehicle_travel_mode: schedule.vehicle_resource?.travel_mode ?? null,
      confirmed: schedule.confirmed_at != null,
      facility_label: schedule.facility_batch
        ? (facilityNameById.get(schedule.facility_batch.facility_id) ?? '施設')
        : null,
      facility_patient_count: schedule.facility_batch_id
        ? (batchPatientCounts.get(schedule.facility_batch_id) ?? 1)
        : 1,
    });

    // 同一ユーザーの重複 membership を除去しつつ、訪問のある担当者を優先して行数を絞る。
    // 当日シフトで不在(available=false)のメンバーはボードに出さない(デザイン 03: 休みはレーン非表示)
    const unavailableUserIds = new Set(unavailableShifts.map((shift) => shift.user_id));
    const seenUserIds = new Set<string>();
    const staffAll: DayBoardStaff[] = [];
    for (const membership of memberships) {
      if (seenUserIds.has(membership.user.id)) continue;
      if (unavailableUserIds.has(membership.user.id)) continue;
      seenUserIds.add(membership.user.id);
      staffAll.push({
        id: membership.user.id,
        name: membership.user.name,
        role: membership.role,
        role_kind: membership.role === 'clerk' ? 'clerk' : 'pharmacist',
        visits: (schedulesByPharmacist.get(membership.user.id) ?? []).map(toBoardVisit),
        open_task_count: openTaskCountByUser.get(membership.user.id) ?? 0,
        audit_task_count: auditCountByUser.get(membership.user.id) ?? 0,
      });
    }
    const staff = [...staffAll]
      .sort((left, right) => {
        if (left.role_kind !== right.role_kind) return left.role_kind === 'pharmacist' ? -1 : 1;
        if (left.visits.length !== right.visits.length) {
          return right.visits.length - left.visits.length;
        }
        return left.name.localeCompare(right.name, 'ja');
      })
      .slice(0, STAFF_ROW_LIMIT);

    // 担当未割当の監査待ちは先頭の薬剤師行に仮配分(デスク作業ブロックの仮置き)
    const firstPharmacist = staff.find((member) => member.role_kind === 'pharmacist');
    if (firstPharmacist && unassignedAuditCount > 0) {
      firstPharmacist.audit_task_count += unassignedAuditCount;
    }

    // 未確定候補: 確定した場合の担当余白(分)の変化を試算
    const pharmacistNameById = new Map(staffAll.map((member) => [member.id, member.name]));
    // proposed_date(@db.Date)は UTC midnight 保存なのでそのまま範囲端に使う
    const proposalImpactPairs = proposals.map((proposal) => ({
      pharmacistId: proposal.proposed_pharmacist_id,
      dayStart: proposal.proposed_date,
    }));
    const impactSchedules =
      proposalImpactPairs.length === 0
        ? []
        : await prisma.visitSchedule.findMany({
            where: {
              org_id: ctx.orgId,
              schedule_status: { notIn: ['cancelled', 'rescheduled'] },
              OR: proposalImpactPairs.map((pair) => ({
                pharmacist_id: pair.pharmacistId,
                scheduled_date: { gte: pair.dayStart, lt: addUtcDays(pair.dayStart, 1) },
              })),
            },
            select: {
              pharmacist_id: true,
              scheduled_date: true,
              time_window_start: true,
              time_window_end: true,
            },
          });

    const proposalIds = proposals.map((proposal) => proposal.id);
    const proposalContactLogs =
      proposalIds.length === 0
        ? []
        : await prisma.visitScheduleContactLog.findMany({
            where: { org_id: ctx.orgId, proposal_id: { in: proposalIds } },
            orderBy: [{ proposal_id: 'asc' }, { called_at: 'desc' }],
            select: { proposal_id: true, callback_due_at: true },
          });
    const latestContactLogByProposalId = new Map<string, (typeof proposalContactLogs)[number]>();
    for (const contactLog of proposalContactLogs) {
      if (contactLog.proposal_id && !latestContactLogByProposalId.has(contactLog.proposal_id)) {
        latestContactLogByProposalId.set(contactLog.proposal_id, contactLog);
      }
    }

    const pendingProposals: DayBoardPendingProposal[] = proposals.map((proposal) => {
      const proposedDateTime = proposal.proposed_date.getTime();
      // @db.Date は UTC midnight 保存なので表示キーも UTC 日付部分を使う
      const proposedDateKey = proposal.proposed_date.toISOString().slice(0, 10);
      const sameDayVisits = impactSchedules.filter(
        (schedule) =>
          schedule.pharmacist_id === proposal.proposed_pharmacist_id &&
          schedule.scheduled_date.getTime() === proposedDateTime,
      );
      const occupied = sameDayVisits.reduce(
        (sum, schedule) =>
          sum +
          visitOccupiedMinutes(schedule.time_window_start, schedule.time_window_end) +
          TRAVEL_MINUTES_PER_VISIT,
        0,
      );
      const idleBefore = Math.max(0, WORKDAY_MINUTES - LUNCH_MINUTES - occupied);
      const proposalMinutes =
        visitOccupiedMinutes(proposal.time_window_start, proposal.time_window_end) +
        TRAVEL_MINUTES_PER_VISIT;
      const idleAfter = Math.max(0, idleBefore - proposalMinutes);

      const latestContactLog = latestContactLogByProposalId.get(proposal.id);

      return {
        id: proposal.id,
        patient_name: proposal.case_.patient.name,
        pharmacist_name: pharmacistNameById.get(proposal.proposed_pharmacist_id) ?? null,
        proposed_date: proposedDateKey,
        time_start: proposal.time_window_start?.toISOString() ?? null,
        badge_label:
          proposal.proposal_status === 'reschedule_pending'
            ? '再調整'
            : proposal.visit_type === 'initial'
              ? '受入判断'
              : '確定待ち',
        response_due_at: latestContactLog?.callback_due_at?.toISOString() ?? null,
        idle_before_minutes: idleBefore,
        idle_after_minutes: idleAfter,
      } satisfies DayBoardPendingProposal;
    });

    const auditPendingCount = auditTaskGroups.reduce((sum, group) => sum + group._count.id, 0);
    const assignedVehicleCounts = new Map<string, number>();
    const unassignedAssignableVisitCountsBySite = new Map<string, number>();
    for (const schedule of schedules) {
      if (schedule.vehicle_resource_id) {
        assignedVehicleCounts.set(
          schedule.vehicle_resource_id,
          (assignedVehicleCounts.get(schedule.vehicle_resource_id) ?? 0) + 1,
        );
      } else if (VEHICLE_ASSIGNABLE_STATUSES.has(schedule.schedule_status)) {
        const siteKey = schedule.site_id ?? '';
        unassignedAssignableVisitCountsBySite.set(
          siteKey,
          (unassignedAssignableVisitCountsBySite.get(siteKey) ?? 0) + 1,
        );
      }
    }
    const vehicleSummaries = vehicleResources.map((vehicle) => {
      const assignedVisitCount = assignedVehicleCounts.get(vehicle.id) ?? 0;
      const remainingStops = Math.max(0, vehicle.max_stops - assignedVisitCount);
      const matchingUnassignedVisitCount =
        unassignedAssignableVisitCountsBySite.get(vehicle.site_id ?? '') ?? 0;
      return {
        id: vehicle.id,
        label: vehicle.label,
        site_id: vehicle.site_id,
        vehicle_code: vehicle.vehicle_code,
        travel_mode: vehicle.travel_mode,
        available: vehicle.available,
        max_stops: vehicle.max_stops,
        assigned_visit_count: assignedVisitCount,
        remaining_stops: remainingStops,
        matching_unassigned_visit_count: matchingUnassignedVisitCount,
        recommended: false,
        recommendation_reason: vehicle.available
          ? remainingStops > 0
            ? `空き ${remainingStops}件`
            : '本日の上限に到達'
          : '停止中',
      };
    });
    const recommendedVehicle = vehicleSummaries
      .filter((vehicle) => vehicle.available && vehicle.remaining_stops > 0)
      .sort(
        (left, right) =>
          Math.min(right.remaining_stops, right.matching_unassigned_visit_count) -
            Math.min(left.remaining_stops, left.matching_unassigned_visit_count) ||
          right.remaining_stops - left.remaining_stops ||
          left.assigned_visit_count - right.assigned_visit_count ||
          left.label.localeCompare(right.label, 'ja'),
      )[0];
    if (recommendedVehicle) {
      recommendedVehicle.recommended = true;
      recommendedVehicle.recommendation_reason =
        recommendedVehicle.matching_unassigned_visit_count > 0
          ? `同一拠点の未割当 ${Math.min(
              recommendedVehicle.remaining_stops,
              recommendedVehicle.matching_unassigned_visit_count,
            )}件を受けられます`
          : `予備枠 ${recommendedVehicle.remaining_stops}件`;
    }

    const responseData: ScheduleDayBoardResponse = {
      generated_at: now.toISOString(),
      date: dateKey,
      staff,
      audit_pending_count: auditPendingCount,
      report_pending_count: reportPendingCount,
      vehicle_resources: vehicleSummaries,
      pending_proposals: pendingProposals,
    };

    return success({ data: responseData });
  },
  {
    permission: 'canVisit',
    message: '訪問予定の閲覧権限がありません',
  },
);
