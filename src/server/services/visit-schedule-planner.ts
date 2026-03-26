import { addDays, differenceInCalendarDays, format, getDay, startOfWeek } from 'date-fns';
import type {
  VisitPriority,
  VisitType,
  VisitAssignmentMode,
  Prisma,
} from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { createRoadTravelEstimator } from './road-routing';
import { evaluateVisitWorkflowGate } from './management-plans';

const DEFAULT_VISIT_DURATION_MINUTES = 60;
const DEFAULT_SHIFT_START = '09:00';
const DEFAULT_SHIFT_END = '18:00';
const MAX_SEARCH_DAYS = 21;

type GenerateProposalParams = {
  orgId: string;
  caseId: string;
  visitType: VisitType;
  priority: VisitPriority;
  candidateCount: number;
  startDate?: Date;
  preferredTimeFrom?: string;
  preferredTimeTo?: string;
  rescheduleSourceScheduleId?: string;
};

type SchedulePoint = {
  routeOrder: number | null;
  lat: number | null;
  lng: number | null;
  address: string | null;
  startsAt: Date | null;
};

type ProposalDraft = {
  org_id: string;
  cycle_id: string | null;
  case_id: string;
  site_id: string | null;
  visit_type: VisitType;
  priority: VisitPriority;
  proposal_status: 'proposed' | 'reschedule_pending';
  patient_contact_status: 'pending';
  proposed_date: Date;
  time_window_start: Date | null;
  time_window_end: Date | null;
  proposed_pharmacist_id: string;
  assignment_mode: VisitAssignmentMode;
  route_order: number;
  route_distance_score: number;
  medication_end_date: Date | null;
  visit_deadline_date: Date | null;
  proposal_reason: string;
  escalation_reason: string | null;
  reschedule_source_schedule_id: string | null;
};

type TravelCost = {
  score: number;
  summary: string;
};

type CandidateScoreBreakdown = {
  geocodePenalty: number;
  facilityBonus: number;
  workloadPenalty: number;
  slackPenalty: number;
  lockPenalty: number;
};

type PreferenceWindow = {
  from?: string;
  to?: string;
};

function toDateKey(value: Date) {
  return format(value, 'yyyy-MM-dd');
}

function setTime(baseDate: Date, timeLike: Date | null | undefined, fallback: string) {
  const [fallbackHour, fallbackMinute] = fallback.split(':').map(Number);
  const result = new Date(baseDate);
  if (!timeLike) {
    result.setHours(fallbackHour, fallbackMinute, 0, 0);
    return result;
  }
  result.setHours(timeLike.getHours(), timeLike.getMinutes(), 0, 0);
  return result;
}

function setClock(baseDate: Date, time: string, fallback: string) {
  const result = new Date(baseDate);
  const source = time || fallback;
  const [hour, minute] = source.split(':').map(Number);
  result.setHours(hour, minute, 0, 0);
  return result;
}

function addMinutes(baseDate: Date, minutes: number) {
  return new Date(baseDate.getTime() + minutes * 60_000);
}

function normalizeWeekdays(value: Prisma.JsonValue | null | undefined) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is number => typeof entry === 'number');
}

function buildWeekKey(value: Date) {
  return format(startOfWeek(value, { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

function readTimeString(value: Date | null | undefined) {
  return value ? format(value, 'HH:mm') : undefined;
}

function intersectWindows(...windows: Array<PreferenceWindow | null | undefined>) {
  let from: string | undefined;
  let to: string | undefined;

  for (const window of windows) {
    if (!window) continue;
    if (window.from && (!from || window.from > from)) {
      from = window.from;
    }
    if (window.to && (!to || window.to < to)) {
      to = window.to;
    }
  }

  if (from && to && from >= to) {
    return null;
  }

  return { from, to };
}

function haversineKm(a: SchedulePoint, b: SchedulePoint) {
  if (
    a.lat == null ||
    a.lng == null ||
    b.lat == null ||
    b.lng == null
  ) {
    return Number.NaN;
  }
  const earthRadiusKm = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(h));
}

function addressFallbackScore(a: SchedulePoint, b: SchedulePoint) {
  const left = (a.address ?? '').trim();
  const right = (b.address ?? '').trim();
  if (!left || !right) return 10;
  return left === right ? 0 : 1;
}

function getFallbackTravelCost(a: SchedulePoint, b: SchedulePoint): TravelCost {
  const geoDistance = haversineKm(a, b);
  if (Number.isFinite(geoDistance)) {
    return {
      score: geoDistance,
      summary: `直線距離 ${geoDistance.toFixed(1)}km`,
    };
  }

  const score = addressFallbackScore(a, b);
  return {
    score,
    summary: score === 0 ? '同一住所フォールバック' : '住所一致優先フォールバック',
  };
}

function sortRoutePoints(points: SchedulePoint[]) {
  return [...points].sort((left, right) => {
    const leftOrder = left.routeOrder ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.routeOrder ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    if (left.startsAt && right.startsAt) {
      return left.startsAt.getTime() - right.startsAt.getTime();
    }
    if (left.startsAt) return -1;
    if (right.startsAt) return 1;
    return 0;
  });
}

async function getTravelCost(
  a: SchedulePoint,
  b: SchedulePoint,
  estimateRoadTravel: ReturnType<typeof createRoadTravelEstimator>
) {
  const roadEstimate = await estimateRoadTravel(a, b);
  if (roadEstimate) {
    return {
      score: roadEstimate.durationMinutes,
      summary: `実道路移動 約${Math.round(roadEstimate.durationMinutes)}分${
        Number.isFinite(roadEstimate.distanceKm)
          ? ` / ${roadEstimate.distanceKm.toFixed(1)}km`
          : ''
      }`,
    } satisfies TravelCost;
  }

  return getFallbackTravelCost(a, b);
}

async function computeRouteInsertion(
  sitePoint: SchedulePoint | null,
  existingPoints: SchedulePoint[],
  candidatePoint: SchedulePoint,
  estimateRoadTravel: ReturnType<typeof createRoadTravelEstimator>
) {
  if (existingPoints.length === 0) {
    const initialCost = sitePoint
      ? await getTravelCost(sitePoint, candidatePoint, estimateRoadTravel)
      : { score: 0, summary: '単独訪問' };
    return {
      routeOrder: 1,
      travelScore: initialCost.score,
      travelSummary: initialCost.summary,
    };
  }

  const ordered = sortRoutePoints(existingPoints);
  let bestIndex = ordered.length;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestSummary = '移動負荷未計算';

  for (let insertIndex = 0; insertIndex <= ordered.length; insertIndex++) {
    const prev = insertIndex === 0 ? sitePoint : ordered[insertIndex - 1];
    const next = ordered[insertIndex] ?? null;
    let score = 0;
    const summaries: string[] = [];
    if (prev) {
      const prevCost = await getTravelCost(prev, candidatePoint, estimateRoadTravel);
      score += prevCost.score;
      summaries.push(`前訪問から ${prevCost.summary}`);
    }
    if (next) {
      const nextCost = await getTravelCost(candidatePoint, next, estimateRoadTravel);
      score += nextCost.score;
      summaries.push(`次訪問へ ${nextCost.summary}`);
    }
    if (prev && next) {
      const bypassCost = await getTravelCost(prev, next, estimateRoadTravel);
      score -= bypassCost.score;
    }
    if (score < bestScore) {
      bestScore = score;
      bestIndex = insertIndex;
      bestSummary = summaries.join(' / ');
    }
  }

  return {
    routeOrder: bestIndex + 1,
    travelScore: Number.isFinite(bestScore) ? bestScore : ordered.length,
    travelSummary: bestSummary,
  };
}

function findAvailableSlot(args: {
  baseDate: Date;
  shiftStart: Date;
  shiftEnd: Date;
  preferredTimeFrom?: string;
  preferredTimeTo?: string;
  existingSchedules: Array<{
    time_window_start: Date | null;
    time_window_end: Date | null;
  }>;
}) {
  const preferredStart = args.preferredTimeFrom
    ? setClock(args.baseDate, args.preferredTimeFrom, DEFAULT_SHIFT_START)
    : args.shiftStart;
  const preferredEnd = args.preferredTimeTo
    ? setClock(args.baseDate, args.preferredTimeTo, DEFAULT_SHIFT_END)
    : args.shiftEnd;
  const windowStart =
    preferredStart > args.shiftStart ? preferredStart : args.shiftStart;
  const windowEnd = preferredEnd < args.shiftEnd ? preferredEnd : args.shiftEnd;

  if (windowEnd <= windowStart) return null;

  const bookings = [...args.existingSchedules]
    .map((schedule) => {
      const start = schedule.time_window_start
        ? setTime(args.baseDate, schedule.time_window_start, DEFAULT_SHIFT_START)
        : args.shiftStart;
      const end = schedule.time_window_end
        ? setTime(args.baseDate, schedule.time_window_end, DEFAULT_SHIFT_END)
        : addMinutes(start, DEFAULT_VISIT_DURATION_MINUTES);
      return { start, end };
    })
    .sort((left, right) => left.start.getTime() - right.start.getTime());

  let cursor = windowStart;
  for (const booking of bookings) {
    if (addMinutes(cursor, DEFAULT_VISIT_DURATION_MINUTES) <= booking.start) {
      return {
        start: cursor,
        end: addMinutes(cursor, DEFAULT_VISIT_DURATION_MINUTES),
      };
    }
    if (booking.end > cursor) {
      cursor = booking.end;
    }
  }

  if (addMinutes(cursor, DEFAULT_VISIT_DURATION_MINUTES) <= windowEnd) {
    return {
      start: cursor,
      end: addMinutes(cursor, DEFAULT_VISIT_DURATION_MINUTES),
    };
  }

  return null;
}

function buildReason(args: {
  medicationEndDate: Date | null;
  routeOrder: number;
  assignmentMode: VisitAssignmentMode;
  careRelationship: 'primary' | 'backup' | 'fallback';
  isEmergencyPriority: boolean;
  travelScore: number;
  travelSummary: string;
  constraintSummary?: string[];
}) {
  const parts = [
    args.medicationEndDate
      ? `服薬最終日 ${format(args.medicationEndDate, 'yyyy-MM-dd')} より前に配置`
      : '服薬期限情報がないため直近日で配置',
    `ルート順 ${args.routeOrder} を提案`,
    args.travelSummary,
  ];
  if (args.careRelationship === 'primary') {
    parts.push('主担当薬剤師を優先');
  } else if (args.careRelationship === 'backup') {
    parts.push('副担当薬剤師を優先');
  } else if (args.assignmentMode === 'fallback') {
    parts.push('担当薬剤師のシフト不一致のため代替薬剤師へ自動エスカレーション');
  }
  if (args.isEmergencyPriority) {
    parts.push('緊急訪問のため即応枠を優先');
  }
  if (Number.isFinite(args.travelScore) && !args.travelSummary.includes('約')) {
    parts.push(`移動負荷スコア ${args.travelScore.toFixed(1)}`);
  }
  if (args.constraintSummary && args.constraintSummary.length > 0) {
    parts.push(...args.constraintSummary);
  }
  return parts.join(' / ');
}

function countLockedSchedules(
  schedules: Array<{
    confirmed_at?: Date | null;
    schedule_status?: string;
  }>
) {
  return schedules.filter(
    (schedule) =>
      schedule.confirmed_at != null ||
      ['ready', 'departed', 'in_progress'].includes(schedule.schedule_status ?? '')
  ).length;
}

function calculateRemainingSlackMinutes(args: {
  baseDate: Date;
  shiftStart: Date;
  shiftEnd: Date;
  existingSchedules: Array<{
    time_window_start: Date | null;
    time_window_end: Date | null;
  }>;
  candidateSlot: {
    start: Date;
    end: Date;
  };
}) {
  const bookings = [
    ...args.existingSchedules.map((schedule) => {
      const start = schedule.time_window_start
        ? setTime(args.baseDate, schedule.time_window_start, DEFAULT_SHIFT_START)
        : args.shiftStart;
      const end = schedule.time_window_end
        ? setTime(args.baseDate, schedule.time_window_end, DEFAULT_SHIFT_END)
        : addMinutes(start, DEFAULT_VISIT_DURATION_MINUTES);
      return { start, end };
    }),
    args.candidateSlot,
  ].sort((left, right) => left.start.getTime() - right.start.getTime());

  let cursor = args.shiftStart;
  let slackMinutes = 0;
  for (const booking of bookings) {
    if (booking.start > cursor) {
      slackMinutes += Math.round((booking.start.getTime() - cursor.getTime()) / 60_000);
    }
    if (booking.end > cursor) {
      cursor = booking.end;
    }
  }
  if (cursor < args.shiftEnd) {
    slackMinutes += Math.round((args.shiftEnd.getTime() - cursor.getTime()) / 60_000);
  }
  return Math.max(0, slackMinutes);
}

export async function generateVisitScheduleProposalDrafts(
  params: GenerateProposalParams
): Promise<ProposalDraft[]> {
  const estimateRoadTravel = createRoadTravelEstimator();
  const planningStart = params.startDate ?? addDays(new Date(), 1);
  planningStart.setHours(0, 0, 0, 0);

  const careCase = await prisma.careCase.findFirst({
    where: {
      id: params.caseId,
      org_id: params.orgId,
      status: { in: ['assessment', 'active', 'on_hold'] },
    },
    include: {
      patient: {
        include: {
          residences: {
            where: { is_primary: true },
            take: 1,
          },
          scheduling_preference: true,
        },
      },
    },
  });
  if (!careCase) {
    throw new Error('CASE_NOT_FOUND');
  }

  const gate = await evaluateVisitWorkflowGate(prisma, {
    orgId: params.orgId,
    patientId: careCase.patient_id,
    caseId: params.caseId,
    asOf: planningStart,
  });
  if (!gate.ok) {
    throw new Error(`VISIT_WORKFLOW_GATE:${gate.issues.join(',')}`);
  }

  const schedulingPreference = careCase.patient.scheduling_preference;
  const preferredWeekdays = normalizeWeekdays(
    schedulingPreference?.preferred_weekdays as Prisma.JsonValue | null | undefined
  );
  const mergedVisitWindow = intersectWindows(
    {
      from: params.preferredTimeFrom,
      to: params.preferredTimeTo,
    },
    {
      from: readTimeString(schedulingPreference?.preferred_time_from),
      to: readTimeString(schedulingPreference?.preferred_time_to),
    },
    {
      from: readTimeString(schedulingPreference?.facility_time_from),
      to: readTimeString(schedulingPreference?.facility_time_to),
    }
  );
  const preferenceNotes: string[] = [];
  if (preferredWeekdays.length > 0) {
    preferenceNotes.push(`患者希望曜日 ${preferredWeekdays.join('/')}`);
  }
  if (schedulingPreference?.family_presence_required) {
    preferenceNotes.push('家族同席条件あり');
  }
  if (careCase.backup_pharmacist_id) {
    preferenceNotes.push('副担当薬剤師を優先考慮');
  }

  const cycle = await prisma.medicationCycle.findFirst({
    where: {
      org_id: params.orgId,
      case_id: params.caseId,
      overall_status: { notIn: ['cancelled', 'reported'] },
    },
    orderBy: { updated_at: 'desc' },
    include: {
      prescription_intakes: {
        include: {
          lines: {
            select: {
              end_date: true,
            },
          },
        },
      },
    },
  });

  const medicationEndDates = cycle?.prescription_intakes.flatMap((intake) => [
    ...intake.lines
      .map((line) => line.end_date)
      .filter((value): value is Date => value != null),
    ...(intake.refill_next_dispense_date ? [intake.refill_next_dispense_date] : []),
  ]) ?? [];
  const medicationEndDate =
    medicationEndDates.length > 0
      ? new Date(Math.max(...medicationEndDates.map((value) => value.getTime())))
      : null;
  const visitDeadlineDate = medicationEndDate
    ? addDays(medicationEndDate, -1)
    : addDays(planningStart, 14);
  const planningEnd = addDays(
    planningStart,
    Math.min(
      MAX_SEARCH_DAYS,
      Math.max(0, differenceInCalendarDays(visitDeadlineDate, planningStart))
    )
  );

  const shifts = await prisma.pharmacistShift.findMany({
    where: {
      org_id: params.orgId,
      available: true,
      date: {
        gte: planningStart,
        lte: planningEnd,
      },
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          max_daily_visits: true,
          max_weekly_visits: true,
          max_travel_minutes: true,
          can_accept_emergency: true,
          visit_specialties: true,
        },
      },
      site: {
        select: {
          id: true,
          name: true,
          address: true,
          lat: true,
          lng: true,
        },
      },
    },
    orderBy: [
      { date: 'asc' },
      { available_from: 'asc' },
    ],
  });

  const holidays = await prisma.businessHoliday.findMany({
    where: {
      org_id: params.orgId,
      is_closed: true,
      date: {
        gte: planningStart,
        lte: planningEnd,
      },
    },
  });
  const holidayByDate = new Map<string, typeof holidays>();
  for (const holiday of holidays) {
    const key = toDateKey(holiday.date);
    const list = holidayByDate.get(key);
    if (list) list.push(holiday);
    else holidayByDate.set(key, [holiday]);
  }

  const confirmedSchedules = await prisma.visitSchedule.findMany({
    where: {
      org_id: params.orgId,
      scheduled_date: {
        gte: planningStart,
        lte: planningEnd,
      },
      schedule_status: {
        notIn: ['cancelled', 'rescheduled'],
      },
    },
    include: {
      case_: {
        include: {
          patient: {
            include: {
              residences: {
                where: { is_primary: true },
                take: 1,
              },
            },
          },
        },
      },
      site: {
        select: {
          address: true,
          lat: true,
          lng: true,
        },
      },
    },
  });

  const confirmedSchedulesByDayAndPharmacist = new Map<string, typeof confirmedSchedules>();
  const confirmedSchedulesByWeekAndPharmacist = new Map<string, typeof confirmedSchedules>();
  for (const schedule of confirmedSchedules) {
    const key = `${schedule.pharmacist_id}:${toDateKey(schedule.scheduled_date)}`;
    const list = confirmedSchedulesByDayAndPharmacist.get(key);
    if (list) list.push(schedule);
    else confirmedSchedulesByDayAndPharmacist.set(key, [schedule]);

    const weekKey = `${schedule.pharmacist_id}:${buildWeekKey(schedule.scheduled_date)}`;
    const weekly = confirmedSchedulesByWeekAndPharmacist.get(weekKey);
    if (weekly) weekly.push(schedule);
    else confirmedSchedulesByWeekAndPharmacist.set(weekKey, [schedule]);
  }

  const primaryResidence = careCase.patient.residences[0] ?? null;
  const candidatePoint: SchedulePoint = {
    routeOrder: null,
    lat: primaryResidence?.lat ?? null,
    lng: primaryResidence?.lng ?? null,
    address: primaryResidence?.address ?? null,
    startsAt: null,
  };

  const candidateShifts = shifts.filter((shift) => {
    if (shift.date > visitDeadlineDate) return false;
    if (
      preferredWeekdays.length > 0 &&
      !preferredWeekdays.includes(getDay(shift.date))
    ) {
      return false;
    }
    if (params.priority === 'emergency' && !shift.user.can_accept_emergency) {
      return false;
    }
    const dayHolidays = holidayByDate.get(toDateKey(shift.date)) ?? [];
    return !dayHolidays.some(
      (holiday) =>
        holiday.site_id == null ||
        holiday.site_id === shift.site_id
    );
  });

  const rankedCandidates = (
    await Promise.all(
      candidateShifts.map(async (shift) => {
        const schedulesForShift =
          confirmedSchedulesByDayAndPharmacist.get(
            `${shift.user_id}:${toDateKey(shift.date)}`
          ) ?? [];
        const schedulesForWeek =
          confirmedSchedulesByWeekAndPharmacist.get(
            `${shift.user_id}:${buildWeekKey(shift.date)}`
          ) ?? [];
        if (
          shift.user.max_daily_visits != null &&
          schedulesForShift.length >= shift.user.max_daily_visits
        ) {
          return null;
        }
        if (
          shift.user.max_weekly_visits != null &&
          schedulesForWeek.length >= shift.user.max_weekly_visits
        ) {
          return null;
        }
        const shiftStart = setTime(shift.date, shift.available_from, DEFAULT_SHIFT_START);
        const shiftEnd = setTime(shift.date, shift.available_to, DEFAULT_SHIFT_END);
        const slot = findAvailableSlot({
          baseDate: shift.date,
          shiftStart,
          shiftEnd,
          preferredTimeFrom: mergedVisitWindow?.from,
          preferredTimeTo: mergedVisitWindow?.to,
          existingSchedules: schedulesForShift,
        });
        if (!slot) return null;

        const routeInsertion = await computeRouteInsertion(
          shift.site
            ? {
                routeOrder: 0,
                lat: shift.site.lat,
                lng: shift.site.lng,
                address: shift.site.address,
                startsAt: null,
              }
            : null,
          schedulesForShift.map((schedule) => ({
            routeOrder: schedule.route_order ?? null,
            lat: schedule.case_.patient.residences[0]?.lat ?? null,
            lng: schedule.case_.patient.residences[0]?.lng ?? null,
            address: schedule.case_.patient.residences[0]?.address ?? null,
            startsAt: schedule.time_window_start
              ? setTime(schedule.scheduled_date, schedule.time_window_start, DEFAULT_SHIFT_START)
              : null,
          })),
          candidatePoint,
          estimateRoadTravel
        );
        if (
          shift.user.max_travel_minutes != null &&
          routeInsertion.travelScore > shift.user.max_travel_minutes
        ) {
          return null;
        }

        const sameFacilityVisits = schedulesForShift.filter((schedule) => {
          const scheduleResidence = schedule.case_.patient.residences[0];
          const candidateBuilding = primaryResidence?.building_id;
          if (candidateBuilding && scheduleResidence?.building_id) {
            return scheduleResidence.building_id === candidateBuilding;
          }
          return (
            Boolean(primaryResidence?.address) &&
            scheduleResidence?.address === primaryResidence?.address
          );
        }).length;

        const assignmentMode: VisitAssignmentMode =
          careCase.primary_pharmacist_id &&
          careCase.primary_pharmacist_id === shift.user_id
            ? 'primary'
            : 'fallback';
        const careRelationship: 'primary' | 'backup' | 'fallback' =
          careCase.primary_pharmacist_id === shift.user_id
            ? 'primary'
            : careCase.backup_pharmacist_id === shift.user_id
              ? 'backup'
              : 'fallback';
        const fallbackPenalty =
          assignmentMode === 'fallback'
            ? careCase.backup_pharmacist_id === shift.user_id
              ? 15
              : 50
            : 0;
        const relationshipBonus =
          careRelationship === 'primary'
            ? -25
            : careRelationship === 'backup'
              ? -12
              : 0;
        const datePenalty = differenceInCalendarDays(shift.date, planningStart) * 10;
        const priorityBonus =
          params.priority === 'emergency'
            ? -20
            : params.priority === 'urgent'
              ? -10
              : 0;
        const geocodePenalty =
          primaryResidence?.lat == null || primaryResidence?.lng == null ? 25 : 0;
        const facilityBonus =
          sameFacilityVisits > 0 ? -Math.min(12, sameFacilityVisits * 4) : 0;
        const workloadPenalty = schedulesForShift.length * 2;
        const lockedSchedules = countLockedSchedules(schedulesForShift);
        const lockPenalty = lockedSchedules * 2;
        const remainingSlackMinutes = calculateRemainingSlackMinutes({
          baseDate: shift.date,
          shiftStart,
          shiftEnd,
          existingSchedules: schedulesForShift,
          candidateSlot: slot,
        });
        const slackPenalty =
          params.priority === 'emergency'
            ? remainingSlackMinutes < DEFAULT_VISIT_DURATION_MINUTES
              ? 18
              : 0
            : remainingSlackMinutes < DEFAULT_VISIT_DURATION_MINUTES * 2
              ? 6
              : 0;
        const scoreBreakdown: CandidateScoreBreakdown = {
          geocodePenalty,
          facilityBonus,
          workloadPenalty,
          slackPenalty,
          lockPenalty,
        };
        const score =
          routeInsertion.travelScore +
          fallbackPenalty +
          relationshipBonus +
          datePenalty +
          scoreBreakdown.geocodePenalty +
          scoreBreakdown.facilityBonus +
          scoreBreakdown.workloadPenalty +
          scoreBreakdown.slackPenalty +
          scoreBreakdown.lockPenalty +
          priorityBonus;

        return {
          score,
          shift,
          slot,
          routeInsertion,
          assignmentMode,
          careRelationship,
          scoreBreakdown,
          sameFacilityVisits,
          existingDailyVisits: schedulesForShift.length,
          lockedSchedules,
          remainingSlackMinutes,
        };
      })
    )
  )
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate != null)
    .sort((left, right) => left.score - right.score)
    .slice(0, params.candidateCount);

  return rankedCandidates.map((candidate, index) => ({
    org_id: params.orgId,
    cycle_id: cycle?.id ?? null,
    case_id: params.caseId,
    site_id: candidate.shift.site_id,
    visit_type: params.visitType,
    priority: params.priority,
    proposal_status: params.rescheduleSourceScheduleId
      ? 'reschedule_pending'
      : 'proposed',
    patient_contact_status: 'pending',
    proposed_date: candidate.shift.date,
    time_window_start: candidate.slot.start,
    time_window_end: candidate.slot.end,
    proposed_pharmacist_id: candidate.shift.user_id,
    assignment_mode: candidate.assignmentMode,
    route_order: candidate.routeInsertion.routeOrder + index,
    route_distance_score: candidate.routeInsertion.travelScore,
      medication_end_date: medicationEndDate,
      visit_deadline_date: visitDeadlineDate,
      proposal_reason: buildReason({
        medicationEndDate,
        routeOrder: candidate.routeInsertion.routeOrder,
        assignmentMode: candidate.assignmentMode,
        careRelationship: candidate.careRelationship,
        isEmergencyPriority: params.priority === 'emergency',
        travelScore: candidate.routeInsertion.travelScore,
        travelSummary: candidate.routeInsertion.travelSummary,
        constraintSummary: [
          ...(mergedVisitWindow?.from || mergedVisitWindow?.to
            ? [
              `患者条件 ${mergedVisitWindow?.from ?? '09:00'}-${mergedVisitWindow?.to ?? '18:00'} 内で配置`,
            ]
          : []),
        ...(candidate.scoreBreakdown.geocodePenalty > 0
          ? ['住所座標未整備のため補正スコアを適用']
          : []),
        ...(candidate.lockedSchedules > 0
          ? [`確定済み・進行中予定 ${candidate.lockedSchedules} 件を固定したまま提案`]
          : ['未確定枠が中心のため再配置余地あり']),
        ...(candidate.sameFacilityVisits > 0
          ? [`同一施設・同住所の訪問を ${candidate.sameFacilityVisits + 1} 件に集約`]
          : []),
        ...(candidate.remainingSlackMinutes < DEFAULT_VISIT_DURATION_MINUTES
          ? ['当日余力が少ないため緊急割込余地は限定的']
          : [`差込余白 約${candidate.remainingSlackMinutes}分を確保`]),
        `当日担当件数 ${candidate.existingDailyVisits + 1} 件目として配置`,
        ...preferenceNotes,
      ],
    }),
    escalation_reason:
      candidate.assignmentMode === 'fallback'
        ? '担当薬剤師の勤務枠が見つからなかったため代替薬剤師を割り当て'
        : null,
    reschedule_source_schedule_id: params.rescheduleSourceScheduleId ?? null,
  }));
}
