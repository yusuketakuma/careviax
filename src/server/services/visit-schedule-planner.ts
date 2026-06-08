import { addDays, differenceInCalendarDays, format, getDay, startOfWeek } from 'date-fns';
import type { VisitPriority, VisitType, VisitAssignmentMode } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { getHomeVisitSpecialMedicalProcedures } from '@/lib/patient/home-visit-intake';
import { applyTimeDateToDate, timeDateToString } from '@/lib/visits/time-of-day';
import { createRoadTravelEstimator } from './road-routing';
import { evaluateVisitWorkflowGate } from './management-plans';
import type { VisitRouteTravelMode } from './visit-route-engine';

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
  travelMode?: VisitRouteTravelMode;
  startDate?: Date;
  lockedDate?: Date;
  preferredTimeFrom?: string;
  preferredTimeTo?: string;
  preferredPharmacistId?: string;
  vehicleResourceId?: string;
  rescheduleSourceScheduleId?: string;
};

type SchedulePoint = {
  routeOrder: number | null;
  lat: number | null;
  lng: number | null;
  address: string | null;
  startsAt: Date | null;
};

type RouteOrderSchedule = {
  route_order: number | null;
  priority?: VisitPriority | null;
  confirmed_at?: Date | null;
  schedule_status?: string | null;
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
  vehicle_resource_id?: string | null;
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
  cadencePenalty: number;
  vehiclePenalty: number;
};

export type ProposalCandidateRejectionCode =
  | 'locked_date_mismatch'
  | 'beyond_deadline'
  | 'weekday_mismatch'
  | 'emergency_capability'
  | 'business_holiday'
  | 'daily_capacity'
  | 'weekly_capacity'
  | 'vehicle_site_mismatch'
  | 'vehicle_capacity'
  | 'no_slot'
  | 'travel_limit'
  | 'billing_constraint'
  | 'not_selected'
  | 'evaluation_error';

export type ProposalCandidateDiagnostic = {
  pharmacist_id: string;
  pharmacist_name: string;
  site_id: string | null;
  site_name: string | null;
  proposed_date: string;
  travel_mode: VisitRouteTravelMode;
  reason_code: ProposalCandidateRejectionCode;
  reason_label: string;
  detail: string;
};

export type AcceptedProposalDiagnostic = {
  pharmacist_id: string;
  pharmacist_name: string;
  site_id: string | null;
  site_name: string | null;
  proposed_date: string;
  travel_mode: VisitRouteTravelMode;
  route_order: number;
  route_distance_score: number;
  travel_summary: string;
  vehicle_resource_id: string | null;
  vehicle_resource_label: string | null;
  vehicle_load: number | null;
  assignment_mode: VisitAssignmentMode;
  care_relationship: 'primary' | 'backup' | 'fallback';
  score: number;
  score_breakdown: CandidateScoreBreakdown;
  time_window_start: Date;
  time_window_end: Date;
};

export type GenerateVisitScheduleProposalResult = {
  drafts: ProposalDraft[];
  diagnostics: {
    accepted: AcceptedProposalDiagnostic[];
    rejected: ProposalCandidateDiagnostic[];
  };
};

type PreferenceWindow = {
  from?: string;
  to?: string;
};

type PlannerVehicleResource = {
  id: string;
  site_id: string;
  label: string;
  travel_mode: VisitRouteTravelMode;
  max_stops: number | null;
};

const REJECTION_REASON_LABELS: Record<ProposalCandidateRejectionCode, string> = {
  locked_date_mismatch: '固定日と不一致',
  beyond_deadline: '提案期限超過',
  weekday_mismatch: '希望曜日不一致',
  emergency_capability: '緊急対応不可',
  business_holiday: '休業日',
  daily_capacity: '日次上限超過',
  weekly_capacity: '週次上限超過',
  vehicle_site_mismatch: '車両拠点不一致',
  vehicle_capacity: '車両上限超過',
  no_slot: '空き枠なし',
  travel_limit: '移動上限超過',
  billing_constraint: '算定制約',
  not_selected: '候補上限外',
  evaluation_error: '評価エラー',
};

function toDateKey(value: Date) {
  return format(value, 'yyyy-MM-dd');
}

function setTime(baseDate: Date, timeLike: Date | null | undefined, fallback: string) {
  return applyTimeDateToDate(baseDate, timeLike, fallback);
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

function normalizeWeekdays(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value.filter(
        (entry): entry is number => typeof entry === 'number' && entry >= 0 && entry <= 6,
      ),
    ),
  );
}

function normalizeVisitBufferMinutes(value: number | null | undefined) {
  if (!Number.isFinite(value ?? Number.NaN)) return 0;
  return Math.max(0, Math.min(240, Math.trunc(value ?? 0)));
}

function scheduleVisitBufferMinutes(
  schedule: {
    case_?: {
      patient?: {
        scheduling_preference?: {
          visit_buffer_minutes: number | null;
        } | null;
      } | null;
    } | null;
  },
  fallbackBufferMinutes: number,
) {
  return Math.max(
    fallbackBufferMinutes,
    normalizeVisitBufferMinutes(
      schedule.case_?.patient?.scheduling_preference?.visit_buffer_minutes,
    ),
  );
}

function buildWeekKey(value: Date) {
  return format(startOfWeek(value, { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

function startOfMonthDate(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function endOfMonthDate(value: Date) {
  return new Date(value.getFullYear(), value.getMonth() + 1, 0, 23, 59, 59, 999);
}

function readTimeString(value: Date | null | undefined) {
  return timeDateToString(value);
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
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) {
    return Number.NaN;
  }
  const earthRadiusKm = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
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
  estimateRoadTravel: ReturnType<typeof createRoadTravelEstimator>,
) {
  const roadEstimate = await estimateRoadTravel(a, b);
  if (roadEstimate) {
    return {
      score: roadEstimate.durationMinutes,
      summary: `実道路移動 約${Math.round(roadEstimate.durationMinutes)}分${
        Number.isFinite(roadEstimate.distanceKm) ? ` / ${roadEstimate.distanceKm.toFixed(1)}km` : ''
      }`,
    } satisfies TravelCost;
  }

  return getFallbackTravelCost(a, b);
}

async function computeRouteInsertion(
  sitePoint: SchedulePoint | null,
  existingPoints: SchedulePoint[],
  candidatePoint: SchedulePoint,
  estimateRoadTravel: ReturnType<typeof createRoadTravelEstimator>,
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
  visitBufferMinutes?: number;
  existingSchedules: Array<{
    time_window_start: Date | null;
    time_window_end: Date | null;
    case_?: {
      patient?: {
        scheduling_preference?: {
          visit_buffer_minutes: number | null;
        } | null;
      } | null;
    } | null;
  }>;
}) {
  const preferredStart = args.preferredTimeFrom
    ? setClock(args.baseDate, args.preferredTimeFrom, DEFAULT_SHIFT_START)
    : args.shiftStart;
  const preferredEnd = args.preferredTimeTo
    ? setClock(args.baseDate, args.preferredTimeTo, DEFAULT_SHIFT_END)
    : args.shiftEnd;
  const windowStart = preferredStart > args.shiftStart ? preferredStart : args.shiftStart;
  const windowEnd = preferredEnd < args.shiftEnd ? preferredEnd : args.shiftEnd;

  if (windowEnd <= windowStart) return null;
  const visitBufferMinutes = normalizeVisitBufferMinutes(args.visitBufferMinutes);

  const bookings = [...args.existingSchedules]
    .map((schedule) => {
      const scheduleBufferMinutes = scheduleVisitBufferMinutes(schedule, visitBufferMinutes);
      const start = schedule.time_window_start
        ? setTime(args.baseDate, schedule.time_window_start, DEFAULT_SHIFT_START)
        : args.shiftStart;
      const end = schedule.time_window_end
        ? setTime(args.baseDate, schedule.time_window_end, DEFAULT_SHIFT_END)
        : addMinutes(start, DEFAULT_VISIT_DURATION_MINUTES);
      return {
        start: addMinutes(start, -scheduleBufferMinutes),
        end: addMinutes(end, scheduleBufferMinutes),
      };
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
  }>,
) {
  return schedules.filter(
    (schedule) =>
      schedule.confirmed_at != null ||
      ['ready', 'departed', 'in_progress'].includes(schedule.schedule_status ?? ''),
  ).length;
}

function visitPriorityRank(priority: VisitPriority | null | undefined) {
  switch (priority) {
    case 'emergency':
      return 0;
    case 'urgent':
      return 1;
    default:
      return 2;
  }
}

function isRouteOrderLocked(schedule: RouteOrderSchedule) {
  return (
    schedule.confirmed_at != null ||
    ['ready', 'departed', 'in_progress', 'completed'].includes(schedule.schedule_status ?? '')
  );
}

function resolvePriorityAwareRouteOrder(args: {
  baseRouteOrder: number;
  priority: VisitPriority;
  existingSchedules: RouteOrderSchedule[];
}) {
  const lockedFloor = args.existingSchedules.reduce((maxOrder, schedule) => {
    if (!isRouteOrderLocked(schedule) || schedule.route_order == null) return maxOrder;
    return Math.max(maxOrder, schedule.route_order);
  }, 0);
  const minimumOrder = lockedFloor + 1;
  const baseOrder = Math.max(args.baseRouteOrder, minimumOrder);
  const candidateRank = visitPriorityRank(args.priority);

  if (candidateRank >= visitPriorityRank('normal')) {
    return baseOrder;
  }

  const lowerPriorityOrders = args.existingSchedules
    .filter(
      (schedule) =>
        !isRouteOrderLocked(schedule) &&
        schedule.route_order != null &&
        schedule.route_order >= minimumOrder &&
        visitPriorityRank(schedule.priority) > candidateRank,
    )
    .map((schedule) => schedule.route_order as number);

  if (lowerPriorityOrders.length === 0) {
    return baseOrder;
  }

  return Math.min(baseOrder, Math.min(...lowerPriorityOrders));
}

function calculateRemainingSlackMinutes(args: {
  baseDate: Date;
  shiftStart: Date;
  shiftEnd: Date;
  existingSchedules: Array<{
    time_window_start: Date | null;
    time_window_end: Date | null;
    case_?: {
      patient?: {
        scheduling_preference?: {
          visit_buffer_minutes: number | null;
        } | null;
      } | null;
    } | null;
  }>;
  visitBufferMinutes?: number;
  candidateSlot: {
    start: Date;
    end: Date;
  };
}) {
  const bookings = [
    ...args.existingSchedules.map((schedule) => {
      const visitBufferMinutes = normalizeVisitBufferMinutes(args.visitBufferMinutes);
      const scheduleBufferMinutes = scheduleVisitBufferMinutes(schedule, visitBufferMinutes);
      const start = schedule.time_window_start
        ? setTime(args.baseDate, schedule.time_window_start, DEFAULT_SHIFT_START)
        : args.shiftStart;
      const end = schedule.time_window_end
        ? setTime(args.baseDate, schedule.time_window_end, DEFAULT_SHIFT_END)
        : addMinutes(start, DEFAULT_VISIT_DURATION_MINUTES);
      return {
        start: addMinutes(start, -scheduleBufferMinutes),
        end: addMinutes(end, scheduleBufferMinutes),
      };
    }),
    {
      start: addMinutes(
        args.candidateSlot.start,
        -normalizeVisitBufferMinutes(args.visitBufferMinutes),
      ),
      end: addMinutes(args.candidateSlot.end, normalizeVisitBufferMinutes(args.visitBufferMinutes)),
    },
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

function selectVehicleResourceForCandidate(args: {
  requestedVehicleResourceId?: string;
  shiftSiteId: string | null;
  travelMode: VisitRouteTravelMode;
  existingSchedules: Array<{
    vehicle_resource_id?: string | null;
  }>;
  vehicleResources: PlannerVehicleResource[];
}):
  | { ok: true; vehicleResource: PlannerVehicleResource | null; vehicleLoad: number }
  | { ok: false; reasonCode: 'vehicle_site_mismatch' | 'vehicle_capacity'; detail: string } {
  const matchingSiteVehicles = args.vehicleResources.filter(
    (vehicle) => vehicle.site_id === args.shiftSiteId && vehicle.travel_mode === args.travelMode,
  );
  const selectedVehicles = args.requestedVehicleResourceId
    ? args.vehicleResources.filter((vehicle) => vehicle.id === args.requestedVehicleResourceId)
    : matchingSiteVehicles;
  const requestedVehicle = args.requestedVehicleResourceId ? selectedVehicles[0] : null;

  if (
    args.requestedVehicleResourceId &&
    (!requestedVehicle || requestedVehicle.site_id !== args.shiftSiteId)
  ) {
    return {
      ok: false,
      reasonCode: 'vehicle_site_mismatch',
      detail: '選択した車両リソースは候補日の勤務拠点では利用できません',
    };
  }

  if (selectedVehicles.length === 0) {
    return { ok: true, vehicleResource: null, vehicleLoad: 0 };
  }

  const candidates = selectedVehicles
    .map((vehicle) => {
      const load = args.existingSchedules.filter(
        (schedule) => schedule.vehicle_resource_id === vehicle.id,
      ).length;
      return { vehicle, load };
    })
    .filter(({ vehicle, load }) => vehicle.max_stops == null || load + 1 <= vehicle.max_stops)
    .sort((left, right) => {
      if (left.load !== right.load) return left.load - right.load;
      return left.vehicle.label.localeCompare(right.vehicle.label, 'ja');
    });

  const [best] = candidates;
  if (best) {
    return { ok: true, vehicleResource: best.vehicle, vehicleLoad: best.load };
  }

  const label = requestedVehicle?.label ?? '利用可能な車両';
  const maxStops = requestedVehicle?.max_stops;
  return {
    ok: false,
    reasonCode: 'vehicle_capacity',
    detail:
      maxStops == null
        ? `${label} の車両リソース容量に空きがありません`
        : `${label} で訪問できる件数は最大 ${maxStops} 件です`,
  };
}

export async function generateVisitScheduleProposalDrafts(
  params: GenerateProposalParams,
): Promise<GenerateVisitScheduleProposalResult> {
  const travelMode = params.travelMode ?? 'DRIVE';
  const estimateRoadTravel = createRoadTravelEstimator(travelMode);
  const planningStart = params.startDate ?? addDays(new Date(), 1);
  planningStart.setHours(0, 0, 0, 0);
  const lockedDate = params.lockedDate ? new Date(params.lockedDate) : null;
  if (lockedDate) {
    lockedDate.setHours(0, 0, 0, 0);
  }

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
            include: {
              facility: {
                select: {
                  acceptance_time_from: true,
                  acceptance_time_to: true,
                  regular_visit_weekdays: true,
                },
              },
            },
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
  const visitBufferMinutes = normalizeVisitBufferMinutes(
    schedulingPreference?.visit_buffer_minutes,
  );
  const primaryFacility = careCase.patient.residences[0]?.facility ?? null;
  const preferredWeekdays = normalizeWeekdays(schedulingPreference?.preferred_weekdays);
  const facilityVisitWeekdays = normalizeWeekdays(primaryFacility?.regular_visit_weekdays);
  // Patient preference takes priority; fall back to facility's regular visit days
  const effectiveWeekdays =
    preferredWeekdays.length > 0 ? preferredWeekdays : facilityVisitWeekdays;
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
    },
    {
      from: readTimeString(primaryFacility?.acceptance_time_from),
      to: readTimeString(primaryFacility?.acceptance_time_to),
    },
  );
  const preferenceNotes: string[] = [];
  if (preferredWeekdays.length > 0) {
    preferenceNotes.push(`患者希望曜日 ${preferredWeekdays.join('/')}`);
  } else if (facilityVisitWeekdays.length > 0) {
    preferenceNotes.push(`施設定期訪問曜日 ${facilityVisitWeekdays.join('/')} を適用`);
  }
  if (primaryFacility?.acceptance_time_from || primaryFacility?.acceptance_time_to) {
    preferenceNotes.push('施設受入時間帯を反映');
  }
  if (visitBufferMinutes > 0) {
    preferenceNotes.push(`訪問前後バッファ ${visitBufferMinutes}分を反映`);
  }
  if (schedulingPreference?.family_presence_required) {
    preferenceNotes.push('家族同席条件あり');
  }
  if (careCase.backup_pharmacist_id) {
    preferenceNotes.push('副担当薬剤師を優先考慮');
  }
  if (params.preferredPharmacistId) {
    preferenceNotes.push('希望担当薬剤師を優先考慮');
  }
  const specialProcedures = getHomeVisitSpecialMedicalProcedures(careCase.required_visit_support);
  const specialCapEligible =
    specialProcedures.includes('narcotics') ||
    specialProcedures.includes('narcotics_injection') ||
    specialProcedures.includes('tpn') ||
    specialProcedures.includes('cv_port') ||
    specialProcedures.includes('central_venous') ||
    specialProcedures.includes('terminal_pain');
  const monthlyCap = specialCapEligible ? 8 : 4;
  const weeklyCap = specialCapEligible ? 2 : null;

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

  const medicationEndDates =
    cycle?.prescription_intakes.flatMap((intake) => [
      ...intake.lines.map((line) => line.end_date).filter((value): value is Date => value != null),
      ...(intake.refill_next_dispense_date ? [intake.refill_next_dispense_date] : []),
    ]) ?? [];
  const medicationEndDate =
    medicationEndDates.length > 0
      ? new Date(Math.max(...medicationEndDates.map((value) => value.getTime())))
      : null;
  const visitDeadlineDate = medicationEndDate
    ? addDays(medicationEndDate, -1)
    : addDays(planningStart, 14);
  const planningEnd = lockedDate
    ? lockedDate
    : addDays(
        planningStart,
        Math.min(
          MAX_SEARCH_DAYS,
          Math.max(0, differenceInCalendarDays(visitDeadlineDate, planningStart)),
        ),
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
    orderBy: [{ date: 'asc' }, { available_from: 'asc' }],
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

  const vehicleResources = await prisma.visitVehicleResource.findMany({
    where: {
      org_id: params.orgId,
      available: true,
      ...(params.vehicleResourceId ? { id: params.vehicleResourceId } : {}),
    },
    select: {
      id: true,
      site_id: true,
      label: true,
      travel_mode: true,
      max_stops: true,
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
      vehicle_resource: {
        select: {
          id: true,
        },
      },
      case_: {
        include: {
          patient: {
            include: {
              residences: {
                where: { is_primary: true },
                take: 1,
              },
              scheduling_preference: {
                select: {
                  visit_buffer_minutes: true,
                },
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
  const confirmedSchedulesByDay = new Map<string, typeof confirmedSchedules>();
  const confirmedSchedulesForPatient = confirmedSchedules.filter(
    (schedule) => schedule.case_.patient.id === careCase.patient_id,
  );
  for (const schedule of confirmedSchedules) {
    const dayKey = toDateKey(schedule.scheduled_date);
    const daySchedules = confirmedSchedulesByDay.get(dayKey);
    if (daySchedules) daySchedules.push(schedule);
    else confirmedSchedulesByDay.set(dayKey, [schedule]);

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

  function buildRejectedDiagnostic(args: {
    shift: (typeof shifts)[number];
    reasonCode: ProposalCandidateRejectionCode;
    detail: string;
  }): ProposalCandidateDiagnostic {
    return {
      pharmacist_id: args.shift.user_id,
      pharmacist_name: args.shift.user.name,
      site_id: args.shift.site_id ?? null,
      site_name: args.shift.site?.name ?? null,
      proposed_date: toDateKey(args.shift.date),
      travel_mode: travelMode,
      reason_code: args.reasonCode,
      reason_label: REJECTION_REASON_LABELS[args.reasonCode],
      detail: args.detail,
    };
  }

  const evaluatedCandidates = await Promise.all(
    shifts.map(async (shift) => {
      if (lockedDate && toDateKey(shift.date) !== toDateKey(lockedDate)) {
        return {
          kind: 'rejected' as const,
          diagnostic: buildRejectedDiagnostic({
            shift,
            reasonCode: 'locked_date_mismatch',
            detail: `固定日 ${toDateKey(lockedDate)} と勤務日 ${toDateKey(shift.date)} が一致しません`,
          }),
        };
      }
      if (shift.date > visitDeadlineDate) {
        return {
          kind: 'rejected' as const,
          diagnostic: buildRejectedDiagnostic({
            shift,
            reasonCode: 'beyond_deadline',
            detail: `訪問期限 ${toDateKey(visitDeadlineDate)} を超えるため候補外です`,
          }),
        };
      }
      if (effectiveWeekdays.length > 0 && !effectiveWeekdays.includes(getDay(shift.date))) {
        return {
          kind: 'rejected' as const,
          diagnostic: buildRejectedDiagnostic({
            shift,
            reasonCode: 'weekday_mismatch',
            detail: `希望曜日 ${effectiveWeekdays.join('/')} に一致しません`,
          }),
        };
      }
      if (params.priority === 'emergency' && !shift.user.can_accept_emergency) {
        return {
          kind: 'rejected' as const,
          diagnostic: buildRejectedDiagnostic({
            shift,
            reasonCode: 'emergency_capability',
            detail: 'この薬剤師は緊急訪問受入設定がありません',
          }),
        };
      }
      const dayHolidays = holidayByDate.get(toDateKey(shift.date)) ?? [];
      if (
        dayHolidays.some((holiday) => holiday.site_id == null || holiday.site_id === shift.site_id)
      ) {
        return {
          kind: 'rejected' as const,
          diagnostic: buildRejectedDiagnostic({
            shift,
            reasonCode: 'business_holiday',
            detail: '拠点休業日のため候補外です',
          }),
        };
      }

      try {
        const schedulesForShift =
          confirmedSchedulesByDayAndPharmacist.get(`${shift.user_id}:${toDateKey(shift.date)}`) ??
          [];
        const schedulesForWeek =
          confirmedSchedulesByWeekAndPharmacist.get(
            `${shift.user_id}:${buildWeekKey(shift.date)}`,
          ) ?? [];
        if (
          shift.user.max_daily_visits != null &&
          schedulesForShift.length >= shift.user.max_daily_visits
        ) {
          return {
            kind: 'rejected' as const,
            diagnostic: buildRejectedDiagnostic({
              shift,
              reasonCode: 'daily_capacity',
              detail: `日次上限 ${shift.user.max_daily_visits} 件に到達しています`,
            }),
          };
        }
        if (
          shift.user.max_weekly_visits != null &&
          schedulesForWeek.length >= shift.user.max_weekly_visits
        ) {
          return {
            kind: 'rejected' as const,
            diagnostic: buildRejectedDiagnostic({
              shift,
              reasonCode: 'weekly_capacity',
              detail: `週次上限 ${shift.user.max_weekly_visits} 件に到達しています`,
            }),
          };
        }
        const vehicleSelection = selectVehicleResourceForCandidate({
          requestedVehicleResourceId: params.vehicleResourceId,
          shiftSiteId: shift.site_id ?? null,
          travelMode,
          existingSchedules: confirmedSchedulesByDay.get(toDateKey(shift.date)) ?? [],
          vehicleResources,
        });
        if (!vehicleSelection.ok) {
          return {
            kind: 'rejected' as const,
            diagnostic: buildRejectedDiagnostic({
              shift,
              reasonCode: vehicleSelection.reasonCode,
              detail: vehicleSelection.detail,
            }),
          };
        }
        const shiftStart = setTime(shift.date, shift.available_from, DEFAULT_SHIFT_START);
        const shiftEnd = setTime(shift.date, shift.available_to, DEFAULT_SHIFT_END);
        const slot = findAvailableSlot({
          baseDate: shift.date,
          shiftStart,
          shiftEnd,
          preferredTimeFrom: mergedVisitWindow?.from,
          preferredTimeTo: mergedVisitWindow?.to,
          visitBufferMinutes,
          existingSchedules: schedulesForShift,
        });
        if (!slot) {
          return {
            kind: 'rejected' as const,
            diagnostic: buildRejectedDiagnostic({
              shift,
              reasonCode: 'no_slot',
              detail: '希望時間帯内に 60 分の空き枠を確保できません',
            }),
          };
        }

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
          estimateRoadTravel,
        );
        if (
          shift.user.max_travel_minutes != null &&
          routeInsertion.travelScore > shift.user.max_travel_minutes
        ) {
          return {
            kind: 'rejected' as const,
            diagnostic: buildRejectedDiagnostic({
              shift,
              reasonCode: 'travel_limit',
              detail: `移動負荷 ${routeInsertion.travelScore.toFixed(1)} が上限 ${shift.user.max_travel_minutes} を超えます`,
            }),
          };
        }

        const sameFacilityVisits = schedulesForShift.filter((schedule) => {
          const scheduleResidence = schedule.case_.patient.residences[0];
          // Unit-level match takes priority over building/address
          const candidateUnitId = primaryResidence?.facility_unit_id;
          if (candidateUnitId && scheduleResidence?.facility_unit_id) {
            return scheduleResidence.facility_unit_id === candidateUnitId;
          }
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
          careCase.primary_pharmacist_id && careCase.primary_pharmacist_id === shift.user_id
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
          careRelationship === 'primary' ? -25 : careRelationship === 'backup' ? -12 : 0;
        const preferredPharmacistBonus = params.preferredPharmacistId === shift.user_id ? -8 : 0;
        const datePenalty = differenceInCalendarDays(shift.date, planningStart) * 10;
        const priorityBonus =
          params.priority === 'emergency' ? -20 : params.priority === 'urgent' ? -10 : 0;
        const geocodePenalty =
          primaryResidence?.lat == null || primaryResidence?.lng == null ? 25 : 0;
        const facilityBonus = sameFacilityVisits > 0 ? -Math.min(12, sameFacilityVisits * 4) : 0;
        const workloadPenalty = schedulesForShift.length * 2;
        const lockedSchedules = countLockedSchedules(schedulesForShift);
        const lockPenalty = lockedSchedules * 2;
        const remainingSlackMinutes = calculateRemainingSlackMinutes({
          baseDate: shift.date,
          shiftStart,
          shiftEnd,
          existingSchedules: schedulesForShift,
          visitBufferMinutes,
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
        const monthlyCountForCandidate = confirmedSchedulesForPatient.filter(
          (schedule) =>
            schedule.scheduled_date >= startOfMonthDate(shift.date) &&
            schedule.scheduled_date <= endOfMonthDate(shift.date),
        ).length;
        const weeklyCountForCandidate =
          weeklyCap == null
            ? 0
            : confirmedSchedulesForPatient.filter(
                (schedule) => buildWeekKey(schedule.scheduled_date) === buildWeekKey(shift.date),
              ).length;
        const cadencePenalty =
          (monthlyCountForCandidate >= monthlyCap ? 120 : 0) +
          (weeklyCap != null && weeklyCountForCandidate >= weeklyCap ? 80 : 0);
        const vehiclePenalty = vehicleSelection.vehicleResource
          ? vehicleSelection.vehicleLoad * 3
          : 0;
        const scoreBreakdown: CandidateScoreBreakdown = {
          geocodePenalty,
          facilityBonus,
          workloadPenalty,
          slackPenalty,
          lockPenalty,
          cadencePenalty,
          vehiclePenalty,
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
          scoreBreakdown.cadencePenalty +
          scoreBreakdown.vehiclePenalty +
          priorityBonus +
          preferredPharmacistBonus;

        return {
          kind: 'accepted' as const,
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
          vehicleResource: vehicleSelection.vehicleResource,
          vehicleLoad: vehicleSelection.vehicleLoad,
          priorityAwareRouteOrder: resolvePriorityAwareRouteOrder({
            baseRouteOrder: routeInsertion.routeOrder,
            priority: params.priority,
            existingSchedules: schedulesForShift,
          }),
        };
      } catch (error) {
        return {
          kind: 'rejected' as const,
          diagnostic: buildRejectedDiagnostic({
            shift,
            reasonCode: 'evaluation_error',
            detail:
              error instanceof Error
                ? `評価中にエラーが発生しました: ${error.message}`
                : '評価中にエラーが発生しました',
          }),
        };
      }
    }),
  );

  const acceptedCandidates = evaluatedCandidates
    .filter(
      (
        candidate,
      ): candidate is Extract<(typeof evaluatedCandidates)[number], { kind: 'accepted' }> =>
        candidate.kind === 'accepted',
    )
    .sort((left, right) => left.score - right.score);

  const selectedCandidates = acceptedCandidates.slice(0, params.candidateCount);
  const overflowCandidates = acceptedCandidates.slice(params.candidateCount);
  const routeOrderOffsetsByCell = new Map<string, number>();
  const selectedCandidatesWithRouteOrder = selectedCandidates.map((candidate) => {
    const cellKey = `${candidate.shift.user_id}:${toDateKey(candidate.shift.date)}`;
    const offset = routeOrderOffsetsByCell.get(cellKey) ?? 0;
    routeOrderOffsetsByCell.set(cellKey, offset + 1);

    return {
      candidate,
      routeOrder: candidate.priorityAwareRouteOrder + offset,
    };
  });

  const drafts = selectedCandidatesWithRouteOrder.map(({ candidate, routeOrder }) => ({
    org_id: params.orgId,
    cycle_id: cycle?.id ?? null,
    case_id: params.caseId,
    site_id: candidate.shift.site_id,
    visit_type: params.visitType,
    priority: params.priority,
    proposal_status: (params.rescheduleSourceScheduleId
      ? 'reschedule_pending'
      : 'proposed') as ProposalDraft['proposal_status'],
    patient_contact_status: 'pending' as ProposalDraft['patient_contact_status'],
    proposed_date: candidate.shift.date,
    time_window_start: candidate.slot.start,
    time_window_end: candidate.slot.end,
    proposed_pharmacist_id: candidate.shift.user_id,
    assignment_mode: candidate.assignmentMode,
    route_order: routeOrder,
    route_distance_score: candidate.routeInsertion.travelScore,
    vehicle_resource_id: candidate.vehicleResource?.id ?? null,
    medication_end_date: medicationEndDate,
    visit_deadline_date: visitDeadlineDate,
    proposal_reason: buildReason({
      medicationEndDate,
      routeOrder,
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
        ...(candidate.scoreBreakdown.cadencePenalty > 0
          ? ['算定間隔・回数制限に近いため後方候補として評価']
          : ['算定間隔・回数上は提案可能日']),
        ...(candidate.lockedSchedules > 0
          ? [`確定済み・進行中予定 ${candidate.lockedSchedules} 件を固定したまま提案`]
          : ['未確定枠が中心のため再配置余地あり']),
        ...(candidate.sameFacilityVisits > 0
          ? [`同一施設・同住所の訪問を ${candidate.sameFacilityVisits + 1} 件に集約`]
          : []),
        ...(candidate.remainingSlackMinutes < DEFAULT_VISIT_DURATION_MINUTES
          ? ['当日余力が少ないため緊急割込余地は限定的']
          : [`差込余白 約${candidate.remainingSlackMinutes}分を確保`]),
        ...(candidate.vehicleResource
          ? [
              `${candidate.vehicleResource.label} を割当（当日同車両 ${candidate.vehicleLoad + 1} 件目）`,
            ]
          : []),
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

  const acceptedDiagnostics: AcceptedProposalDiagnostic[] = selectedCandidatesWithRouteOrder.map(
    ({ candidate, routeOrder }) => ({
      pharmacist_id: candidate.shift.user_id,
      pharmacist_name: candidate.shift.user.name,
      site_id: candidate.shift.site_id ?? null,
      site_name: candidate.shift.site?.name ?? null,
      proposed_date: toDateKey(candidate.shift.date),
      travel_mode: travelMode,
      route_order: routeOrder,
      route_distance_score: candidate.routeInsertion.travelScore,
      travel_summary: candidate.routeInsertion.travelSummary,
      vehicle_resource_id: candidate.vehicleResource?.id ?? null,
      vehicle_resource_label: candidate.vehicleResource?.label ?? null,
      vehicle_load: candidate.vehicleResource ? candidate.vehicleLoad + 1 : null,
      assignment_mode: candidate.assignmentMode,
      care_relationship: candidate.careRelationship,
      score: candidate.score,
      score_breakdown: candidate.scoreBreakdown,
      time_window_start: candidate.slot.start,
      time_window_end: candidate.slot.end,
    }),
  );

  const rejectedDiagnostics = [
    ...evaluatedCandidates
      .filter(
        (
          candidate,
        ): candidate is Extract<(typeof evaluatedCandidates)[number], { kind: 'rejected' }> =>
          candidate.kind === 'rejected',
      )
      .map((candidate) => candidate.diagnostic),
    ...overflowCandidates.map((candidate) =>
      buildRejectedDiagnostic({
        shift: candidate.shift,
        reasonCode: 'not_selected',
        detail: `候補上限 ${params.candidateCount} 件のため採用外です（スコア ${candidate.score.toFixed(1)}）`,
      }),
    ),
  ];

  return {
    drafts,
    diagnostics: {
      accepted: acceptedDiagnostics,
      rejected: rejectedDiagnostics,
    },
  };
}
