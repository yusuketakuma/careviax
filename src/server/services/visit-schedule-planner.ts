import { addDays, differenceInCalendarDays, getDay } from 'date-fns';
import type { Prisma, VisitPriority, VisitType, VisitAssignmentMode } from '@prisma/client';
import { buildOperatingCalendarFromDbRows } from '@/lib/calendar/operating-day-adapter';
import { resolveOperatingState } from '@/lib/calendar/operating-day';
import { canVisitOn, type VisitAvailabilityBlockedReason } from '@/lib/calendar/visit-availability';
import { formatUtcDateKey } from '@/lib/date-key';
import { prisma } from '@/lib/db/client';
import { mapWithConcurrency, normalizeConcurrencyLimit } from '@/lib/utils/concurrency';
import { addUtcDays, localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { getHomeVisitSpecialMedicalProcedures } from '@/lib/patient/home-visit-intake';
import { applyTimeDateToDate, timeDateToString } from '@/lib/visits/time-of-day';
import {
  createRoadTravelEstimator,
  estimateFallbackTravelMinutes,
  type TravelEstimate,
} from './road-routing';
import { evaluateVisitWorkflowGate } from './management-plans';
import {
  resolveEarliestMedicationEndDate,
  resolveVisitDeadlinePolicy,
  type VisitDeadlineDiagnostic,
  type VisitDeadlinePolicy,
} from './visit-medication-deadline';
import type { VisitRouteTravelMode } from './visit-route-engine';
import {
  ACTIVE_BILLING_SCHEDULE_STATUSES,
  buildBillingWeekKey,
  startOfBillingMonth,
} from './billing-cadence';

const DEFAULT_VISIT_DURATION_MINUTES = 60;
const DEFAULT_SHIFT_START = '09:00';
const DEFAULT_SHIFT_END = '18:00';
const MAX_SEARCH_DAYS = 21;
const OVERDUE_ASAP_SEARCH_DAYS = 3;
const DEADLINE_POLICY_SCAN_BUFFER_DAYS = 7;
const DEADLINE_POLICY_SAFETY_BUFFER_OPERATING_DAYS = 1;
const SPECIALTY_MISMATCH_BASE_PENALTY = 20;
const SPECIALTY_MISMATCH_PER_REQUIREMENT_PENALTY = 20;
const MAX_SPECIALTY_MISMATCH_PENALTY = 60;
const DEFAULT_PLANNER_CANDIDATE_EVALUATION_CONCURRENCY = 8;
const MAX_PLANNER_CANDIDATE_EVALUATION_CONCURRENCY = 16;

function normalizePlannerCandidateEvaluationConcurrency(value: unknown) {
  return normalizeConcurrencyLimit(value, {
    defaultValue: DEFAULT_PLANNER_CANDIDATE_EVALUATION_CONCURRENCY,
    max: MAX_PLANNER_CANDIDATE_EVALUATION_CONCURRENCY,
  });
}

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
  operatingDayOverrideReason?: string;
};

export type VehicleRouteDurationPoint = {
  routeOrder: number | null;
  lat: number | null;
  lng: number | null;
  address: string | null;
  startsAt: Date | null;
};

type SchedulePoint = VehicleRouteDurationPoint;

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
  limitMinutes: number | null;
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
  specialtyPenalty: number;
};

type SpecialtyCoverageMatchStatus = 'not_required' | 'matched' | 'unmatched' | 'unknown';

export type SpecialtyCoverageDiagnostic = {
  required_labels: string[];
  missing_labels: string[];
  unknown_procedure_count: number;
  match_status: SpecialtyCoverageMatchStatus;
  source: 'user_visit_specialties_free_text';
};

type SpecialtyRequirement = {
  label: string;
  patterns: readonly RegExp[];
};

const UNKNOWN_SPECIALTY_REQUIREMENT: SpecialtyRequirement = {
  label: '未定義手技',
  patterns: [],
};

const SPECIALTY_REQUIREMENTS_BY_PROCEDURE: Record<string, SpecialtyRequirement> = {
  aseptic_preparation: {
    label: '無菌調剤',
    patterns: [/無菌/i, /混注/i, /aseptic/i, /sterile/i],
  },
  tpn: {
    label: 'TPN',
    patterns: [/tpn/i, /高カロリー/i, /中心静脈栄養/i, /輸液/i],
  },
  cv_port: {
    label: 'CVポート',
    patterns: [/cv\s*ポート/i, /cvport/i, /中心静脈/i, /ポート/i],
  },
  cv: {
    label: '中心静脈',
    patterns: [/中心静脈/i, /cv/i, /cvc/i],
  },
  picc: {
    label: 'PICC',
    patterns: [/picc/i, /中心静脈/i, /カテーテル/i],
  },
  central_venous: {
    label: '中心静脈',
    patterns: [/中心静脈/i, /cvc/i, /tpn/i],
  },
  infusion: {
    label: '点滴',
    patterns: [/点滴/i, /輸液/i, /infusion/i],
  },
  narcotics: {
    label: '麻薬管理',
    patterns: [/麻薬/i, /疼痛/i, /緩和/i, /narcotic/i, /palliative/i],
  },
  narcotics_injection: {
    label: '医療用麻薬持続注射',
    patterns: [/(麻薬.*(持続|注射|pca)|(持続|注射|pca).*麻薬)/i, /pca/i],
  },
  terminal_pain: {
    label: '末期疼痛管理',
    patterns: [/疼痛/i, /緩和/i, /終末期/i, /terminal/i, /palliative/i],
  },
  home_oxygen: {
    label: '在宅酸素',
    patterns: [/酸素/i, /呼吸/i, /hot/i],
  },
  ventilator: {
    label: '人工呼吸器',
    patterns: [/人工呼吸/i, /呼吸器/i, /ventilator/i],
  },
  tracheostomy_suction: {
    label: '気管切開・吸引',
    patterns: [/気管切開/i, /吸引/i],
  },
  enteral_nutrition: {
    label: '経管栄養',
    patterns: [/経管/i, /胃ろう/i, /胃瘻/i, /peg/i],
  },
  enteral_route: {
    label: '経管投与',
    patterns: [/経管/i, /胃ろう/i, /胃瘻/i, /peg/i],
  },
  enteral: {
    label: '経管栄養',
    patterns: [/経管/i, /胃ろう/i, /胃瘻/i, /peg/i],
  },
  tube_feeding: {
    label: '経管栄養',
    patterns: [/経管/i, /胃ろう/i, /胃瘻/i, /peg/i],
  },
  gastrostomy: {
    label: '胃ろう',
    patterns: [/胃ろう/i, /胃瘻/i, /peg/i],
  },
  peg: {
    label: 'PEG',
    patterns: [/peg/i, /胃ろう/i, /胃瘻/i],
  },
  catheter: {
    label: 'カテーテル',
    patterns: [/カテーテル/i, /catheter/i],
  },
  foley_arrangement: {
    label: 'フーリー手配',
    patterns: [/フーリー/i, /バルーン/i, /カテーテル/i],
  },
  dialysis: {
    label: '透析',
    patterns: [/透析/i, /dialysis/i],
  },
  pressure_ulcer: {
    label: '褥瘡処置',
    patterns: [/褥瘡/i, /創傷/i],
  },
  stoma: {
    label: 'ストーマ処置',
    patterns: [/ストーマ/i, /stoma/i],
  },
};

export type ProposalCandidateRejectionCode =
  | VisitAvailabilityBlockedReason
  | 'locked_date_mismatch'
  | 'locked_date_deadline_violation'
  | 'beyond_deadline'
  | 'weekday_mismatch'
  | 'emergency_capability'
  | 'business_holiday'
  | 'daily_capacity'
  | 'weekly_capacity'
  | 'vehicle_site_mismatch'
  | 'vehicle_travel_mode_mismatch'
  | 'vehicle_capacity'
  | 'vehicle_route_duration'
  | 'no_slot'
  | 'travel_limit'
  | 'travel_limit_unverified'
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
  availability_reason_code?: VisitAvailabilityBlockedReason;
};

export type ProposalDeadlinePolicyDiagnostic =
  | (VisitDeadlineDiagnostic & {
      site_id?: string | null;
    })
  | {
      code: 'locked_date_deadline_violation';
      site_id: string | null;
      date_key: string;
      value: string;
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
  specialty_coverage: SpecialtyCoverageDiagnostic;
  time_window_start: Date;
  time_window_end: Date;
};

export type GenerateVisitScheduleProposalResult = {
  drafts: ProposalDraft[];
  diagnostics: {
    accepted: AcceptedProposalDiagnostic[];
    rejected: ProposalCandidateDiagnostic[];
    deadline_policy?: ProposalDeadlinePolicyDiagnostic[];
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
  max_route_duration_minutes: number | null;
};

type PlannerVehicleCandidate = {
  vehicleResource: PlannerVehicleResource;
  vehicleLoad: number;
};

const REJECTION_REASON_LABELS: Record<ProposalCandidateRejectionCode, string> = {
  pharmacy_holiday: '薬局休業日',
  pharmacy_regular_closed: '薬局定休日',
  invalid_pharmacy_operating_window: '薬局営業時間不正',
  outside_pharmacy_operating_window: '薬局営業時間外',
  pharmacist_shift_missing: '薬剤師シフトなし',
  pharmacist_shift_site_missing: 'シフト拠点未設定',
  pharmacist_shift_site_mismatch: 'シフト拠点不一致',
  pharmacist_unavailable: '薬剤師シフト不可',
  invalid_pharmacist_shift_window: '薬剤師シフト時間不正',
  invalid_visit_window: '訪問可能時間不正',
  outside_pharmacist_shift_window: '薬剤師シフト時間外',
  locked_date_mismatch: '固定日と不一致',
  locked_date_deadline_violation: '固定日が訪問期限超過',
  beyond_deadline: '提案期限超過',
  weekday_mismatch: '希望曜日不一致',
  emergency_capability: '緊急対応不可',
  business_holiday: '休業日',
  daily_capacity: '日次上限超過',
  weekly_capacity: '週次上限超過',
  vehicle_site_mismatch: '車両拠点不一致',
  vehicle_travel_mode_mismatch: '車両移動手段不一致',
  vehicle_capacity: '車両上限超過',
  vehicle_route_duration: '車両稼働時間超過',
  no_slot: '空き枠なし',
  travel_limit: '移動上限超過',
  travel_limit_unverified: '移動上限未検証',
  billing_constraint: '算定制約',
  not_selected: '候補上限外',
  evaluation_error: '評価エラー',
};

function operatingDayRejectionDetail(reason: 'holiday' | 'regular_closed') {
  return reason === 'regular_closed' ? '拠点定休日のため候補外です' : '拠点休業日のため候補外です';
}

function availabilityReasonDetail(reason: VisitAvailabilityBlockedReason) {
  switch (reason) {
    case 'pharmacy_holiday':
      return operatingDayRejectionDetail('holiday');
    case 'pharmacy_regular_closed':
      return operatingDayRejectionDetail('regular_closed');
    case 'invalid_pharmacy_operating_window':
      return '薬局営業時間設定が不正なため候補外です';
    case 'pharmacist_shift_missing':
      return '薬剤師シフトが見つからないため候補外です';
    case 'pharmacist_shift_site_missing':
      return '薬剤師シフトの拠点が未設定のため候補外です';
    case 'pharmacist_shift_site_mismatch':
      return '薬剤師シフトの拠点が薬局営業時間の拠点と一致しないため候補外です';
    case 'pharmacist_unavailable':
      return '薬剤師シフトが利用不可のため候補外です';
    case 'invalid_pharmacist_shift_window':
      return '薬剤師シフト時間設定が不正なため候補外です';
    case 'invalid_visit_window':
      return '訪問可能時間帯の設定が不正なため候補外です';
    case 'outside_pharmacy_operating_window':
      return '薬局営業時間と訪問可能時間帯が重ならないため候補外です';
    case 'outside_pharmacist_shift_window':
      return '薬剤師シフト時間と訪問可能時間帯が重ならないため候補外です';
  }
}

function toDateKey(value: Date) {
  return formatUtcDateKey(value);
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
  return buildBillingWeekKey(value);
}

function startOfMonthDate(value: Date) {
  return startOfBillingMonth(value);
}

function buildMonthKey(value: Date) {
  return toDateKey(startOfMonthDate(value));
}

function incrementCount(counts: Map<string, number>, key: string) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
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

function normalizeVisitSpecialties(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveSpecialtyRequirementsForProcedures(procedureCodes: string[]) {
  const requirements = new Map<string, SpecialtyRequirement>();
  let unknownProcedureCount = 0;
  for (const rawCode of procedureCodes) {
    const code = rawCode.trim();
    if (!code) continue;
    const requirement = SPECIALTY_REQUIREMENTS_BY_PROCEDURE[code];
    if (requirement) {
      requirements.set(requirement.label, requirement);
    } else {
      unknownProcedureCount += 1;
      requirements.set(UNKNOWN_SPECIALTY_REQUIREMENT.label, UNKNOWN_SPECIALTY_REQUIREMENT);
    }
  }
  return {
    requirements: [...requirements.values()],
    unknownProcedureCount,
  };
}

function specialtyRequirementMatches(requirement: SpecialtyRequirement, specialties: string[]) {
  return specialties.some((specialty) =>
    requirement.patterns.some((pattern) => pattern.test(specialty)),
  );
}

function assessSpecialtyCoverage(args: { specialProcedures: string[]; visitSpecialties: unknown }) {
  const { requirements, unknownProcedureCount } = resolveSpecialtyRequirementsForProcedures(
    args.specialProcedures,
  );
  const specialties = normalizeVisitSpecialties(args.visitSpecialties);
  const missingLabels = requirements
    .filter((requirement) => !specialtyRequirementMatches(requirement, specialties))
    .map((requirement) => requirement.label);
  const penalty =
    missingLabels.length === 0
      ? 0
      : Math.min(
          MAX_SPECIALTY_MISMATCH_PENALTY,
          SPECIALTY_MISMATCH_BASE_PENALTY +
            missingLabels.length * SPECIALTY_MISMATCH_PER_REQUIREMENT_PENALTY,
        );
  const matchStatus: SpecialtyCoverageMatchStatus =
    requirements.length === 0
      ? 'not_required'
      : unknownProcedureCount > 0
        ? 'unknown'
        : missingLabels.length > 0
          ? 'unmatched'
          : 'matched';

  return {
    requiredLabels: requirements.map((requirement) => requirement.label),
    missingLabels,
    unknownProcedureCount,
    matchStatus,
    penalty,
  };
}

function specialtyCoverageDiagnostic(coverage: ReturnType<typeof assessSpecialtyCoverage>) {
  return {
    required_labels: coverage.requiredLabels,
    missing_labels: coverage.missingLabels,
    unknown_procedure_count: coverage.unknownProcedureCount,
    match_status: coverage.matchStatus,
    source: 'user_visit_specialties_free_text',
  } satisfies SpecialtyCoverageDiagnostic;
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

function getFallbackTravelCost(
  a: SchedulePoint,
  b: SchedulePoint,
  travelMode: VisitRouteTravelMode,
): TravelCost {
  const geoDistance = haversineKm(a, b);
  if (Number.isFinite(geoDistance)) {
    const durationMinutes = estimateFallbackTravelMinutes(geoDistance, travelMode);
    return {
      score: durationMinutes,
      limitMinutes: durationMinutes,
      summary: `直線距離 ${geoDistance.toFixed(1)}km（推定${Math.round(durationMinutes)}分）`,
    };
  }

  const score = addressFallbackScore(a, b);
  return {
    score,
    limitMinutes: null,
    summary:
      score === 0
        ? '座標未設定のため同一住所フォールバック（移動上限は未検証）'
        : '座標未設定のため住所一致優先フォールバック（移動上限は未検証）',
  };
}

function travelEstimateToCost(
  estimate: TravelEstimate | null,
  a: SchedulePoint,
  b: SchedulePoint,
  travelMode: VisitRouteTravelMode,
) {
  if (estimate) {
    return {
      score: estimate.durationMinutes,
      limitMinutes: estimate.durationMinutes,
      summary: `実道路移動 約${Math.round(estimate.durationMinutes)}分${
        Number.isFinite(estimate.distanceKm) ? ` / ${estimate.distanceKm.toFixed(1)}km` : ''
      }`,
    } satisfies TravelCost;
  }

  return getFallbackTravelCost(a, b, travelMode);
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

function canInsertAtRouteTimePosition(args: {
  candidatePoint: SchedulePoint;
  previousPoint: SchedulePoint | null;
  nextPoint: SchedulePoint | null;
}) {
  if (!args.candidatePoint.startsAt) return true;
  const candidateTime = args.candidatePoint.startsAt.getTime();
  if (args.previousPoint?.startsAt && args.previousPoint.startsAt.getTime() > candidateTime) {
    return false;
  }
  if (args.nextPoint?.startsAt && args.nextPoint.startsAt.getTime() < candidateTime) {
    return false;
  }
  return true;
}

function sortVehicleRoutePoints(points: SchedulePoint[]) {
  return [...points].sort((left, right) => {
    if (left.startsAt && right.startsAt) {
      const diff = left.startsAt.getTime() - right.startsAt.getTime();
      if (diff !== 0) return diff;
    }
    if (left.startsAt) return -1;
    if (right.startsAt) return 1;

    const leftOrder = left.routeOrder ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.routeOrder ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return 0;
  });
}

async function getTravelCost(
  a: SchedulePoint,
  b: SchedulePoint,
  estimateRoadTravel: ReturnType<typeof createRoadTravelEstimator>,
  travelMode: VisitRouteTravelMode,
) {
  const roadEstimate = await estimateRoadTravel(a, b);
  return travelEstimateToCost(roadEstimate, a, b, travelMode);
}

async function buildRouteInsertionTravelCostLookup(args: {
  sitePoint: SchedulePoint | null;
  orderedPoints: SchedulePoint[];
  candidatePoint: SchedulePoint;
  estimateRoadTravel: ReturnType<typeof createRoadTravelEstimator>;
  travelMode: VisitRouteTravelMode;
}) {
  const nodes = [
    ...(args.sitePoint ? [args.sitePoint] : []),
    ...args.orderedPoints,
    args.candidatePoint,
  ];
  if (nodes.length < 2) {
    return (a: SchedulePoint, b: SchedulePoint) =>
      getTravelCost(a, b, args.estimateRoadTravel, args.travelMode);
  }

  const matrix =
    'estimateMatrix' in args.estimateRoadTravel &&
    typeof args.estimateRoadTravel.estimateMatrix === 'function'
      ? await args.estimateRoadTravel.estimateMatrix(nodes)
      : null;
  if (!matrix) {
    return (a: SchedulePoint, b: SchedulePoint) =>
      getTravelCost(a, b, args.estimateRoadTravel, args.travelMode);
  }

  const indexByPoint = new Map(nodes.map((point, index) => [point, index]));
  return async (a: SchedulePoint, b: SchedulePoint) => {
    const fromIndex = indexByPoint.get(a);
    const toIndex = indexByPoint.get(b);
    if (fromIndex == null || toIndex == null) {
      return getTravelCost(a, b, args.estimateRoadTravel, args.travelMode);
    }
    return travelEstimateToCost(matrix[fromIndex]?.[toIndex] ?? null, a, b, args.travelMode);
  };
}

async function computeRouteInsertion(
  sitePoint: SchedulePoint | null,
  existingPoints: SchedulePoint[],
  candidatePoint: SchedulePoint,
  estimateRoadTravel: ReturnType<typeof createRoadTravelEstimator>,
  travelMode: VisitRouteTravelMode,
) {
  if (existingPoints.length === 0) {
    if (!sitePoint) {
      return {
        routeOrder: 1,
        travelScore: 0,
        travelLimitMinutes: null,
        travelSummary: '拠点座標未設定のため単独訪問（移動上限は未検証）',
      };
    }
    const lookupTravelCost = await buildRouteInsertionTravelCostLookup({
      sitePoint,
      orderedPoints: [],
      candidatePoint,
      estimateRoadTravel,
      travelMode,
    });
    const initialCost = await lookupTravelCost(sitePoint, candidatePoint);
    return {
      routeOrder: 1,
      travelScore: initialCost.score,
      travelLimitMinutes: initialCost.limitMinutes,
      travelSummary: initialCost.summary,
    };
  }

  const ordered = sortRoutePoints(existingPoints);
  const lookupTravelCost = await buildRouteInsertionTravelCostLookup({
    sitePoint,
    orderedPoints: ordered,
    candidatePoint,
    estimateRoadTravel,
    travelMode,
  });
  let bestIndex = ordered.length;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestLimitMinutes: number | null = null;
  let bestSummary = '移動負荷未計算';

  for (let insertIndex = 0; insertIndex <= ordered.length; insertIndex++) {
    const prev = insertIndex === 0 ? sitePoint : ordered[insertIndex - 1];
    const next = ordered[insertIndex] ?? null;
    if (
      !canInsertAtRouteTimePosition({
        candidatePoint,
        previousPoint: insertIndex === 0 ? null : prev,
        nextPoint: next,
      })
    ) {
      continue;
    }
    let score = 0;
    let candidateAdjacentMinutes = 0;
    let isTravelLimitVerifiable = !(insertIndex === 0 && !prev);
    const summaries: string[] = [];
    if (prev) {
      const prevCost = await lookupTravelCost(prev, candidatePoint);
      score += prevCost.score;
      if (prevCost.limitMinutes == null) {
        isTravelLimitVerifiable = false;
      } else {
        candidateAdjacentMinutes += prevCost.limitMinutes;
      }
      summaries.push(`前訪問から ${prevCost.summary}`);
    }
    if (next) {
      const nextCost = await lookupTravelCost(candidatePoint, next);
      score += nextCost.score;
      if (nextCost.limitMinutes == null) {
        isTravelLimitVerifiable = false;
      } else {
        candidateAdjacentMinutes += nextCost.limitMinutes;
      }
      summaries.push(`次訪問へ ${nextCost.summary}`);
    }
    if (prev && next) {
      const bypassCost = await lookupTravelCost(prev, next);
      score -= bypassCost.score;
    }
    if (score < bestScore) {
      bestScore = score;
      bestIndex = insertIndex;
      bestSummary = summaries.join(' / ');
      bestLimitMinutes = isTravelLimitVerifiable ? Math.max(0, candidateAdjacentMinutes) : null;
    }
  }

  return {
    routeOrder: bestIndex + 1,
    travelScore: Number.isFinite(bestScore) ? bestScore : ordered.length,
    travelLimitMinutes: bestLimitMinutes,
    travelSummary: bestSummary,
  };
}

async function computeRouteTotalDurationMinutes(
  sitePoint: SchedulePoint | null,
  routePoints: SchedulePoint[],
  estimateRoadTravel: ReturnType<typeof createRoadTravelEstimator>,
  travelMode: VisitRouteTravelMode,
) {
  if (!sitePoint) {
    return {
      durationMinutes: null,
      summary: '拠点座標未設定のため車両稼働上限を検証できません',
    };
  }
  if (routePoints.length === 0) {
    return { durationMinutes: 0, summary: '訪問予定なし' };
  }

  let totalMinutes = 0;
  let previousPoint = sitePoint;
  for (let index = 0; index < routePoints.length; index++) {
    const point = routePoints[index];
    const cost = await getTravelCost(previousPoint, point, estimateRoadTravel, travelMode);
    if (cost.limitMinutes == null) {
      return {
        durationMinutes: null,
        summary: `第${index + 1}訪問までの移動時間を検証できません（${cost.summary}）`,
      };
    }
    totalMinutes += cost.limitMinutes;
    previousPoint = point;
  }

  const returnCost = await getTravelCost(previousPoint, sitePoint, estimateRoadTravel, travelMode);
  if (returnCost.limitMinutes == null) {
    return {
      durationMinutes: null,
      summary: `拠点へ戻る移動時間を検証できません（${returnCost.summary}）`,
    };
  }
  totalMinutes += returnCost.limitMinutes;
  return {
    durationMinutes: totalMinutes,
    summary: `拠点発着の総移動時間 約${Math.round(totalMinutes)}分`,
  };
}

async function computeBestRouteDurationWithCandidate(
  sitePoint: SchedulePoint | null,
  existingPoints: SchedulePoint[],
  candidatePoint: SchedulePoint,
  estimateRoadTravel: ReturnType<typeof createRoadTravelEstimator>,
  travelMode: VisitRouteTravelMode,
) {
  const routePoints = sortVehicleRoutePoints([...existingPoints, candidatePoint]);
  const estimate = await computeRouteTotalDurationMinutes(
    sitePoint,
    routePoints,
    estimateRoadTravel,
    travelMode,
  );

  return {
    durationMinutes: estimate.durationMinutes,
    summary: estimate.summary,
  };
}

export const estimateVehicleRouteDurationWithCandidate = computeBestRouteDurationWithCandidate;

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
  visitDeadlineDate: Date | null;
  deadlineOverdue: boolean;
  routeOrder: number;
  assignmentMode: VisitAssignmentMode;
  careRelationship: 'primary' | 'backup' | 'fallback';
  isEmergencyPriority: boolean;
  travelScore: number;
  travelSummary: string;
  constraintSummary?: string[];
}) {
  const deadlineSummary = args.visitDeadlineDate
    ? args.deadlineOverdue
      ? `訪問期限 ${formatUtcDateKey(args.visitDeadlineDate)} 超過のため最短候補を配置`
      : `訪問期限 ${formatUtcDateKey(args.visitDeadlineDate)} までに配置`
    : args.medicationEndDate
      ? `服薬最終日 ${formatUtcDateKey(args.medicationEndDate)} までに配置`
      : '服薬期限情報がないため直近日で配置';
  const parts = [deadlineSummary, `ルート順 ${args.routeOrder} を提案`, args.travelSummary];
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
  | {
      ok: true;
      vehicleResource: PlannerVehicleResource | null;
      vehicleLoad: number;
      vehicleCandidates: PlannerVehicleCandidate[];
    }
  | {
      ok: false;
      reasonCode: 'vehicle_site_mismatch' | 'vehicle_travel_mode_mismatch' | 'vehicle_capacity';
      detail: string;
    } {
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
  if (args.requestedVehicleResourceId && requestedVehicle?.travel_mode !== args.travelMode) {
    return {
      ok: false,
      reasonCode: 'vehicle_travel_mode_mismatch',
      detail: `選択した車両リソース ${requestedVehicle?.label ?? ''} は ${args.travelMode} では利用できません`,
    };
  }

  if (selectedVehicles.length === 0) {
    return { ok: true, vehicleResource: null, vehicleLoad: 0, vehicleCandidates: [] };
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
    return {
      ok: true,
      vehicleResource: best.vehicle,
      vehicleLoad: best.load,
      vehicleCandidates: candidates.map(({ vehicle, load }) => ({
        vehicleResource: vehicle,
        vehicleLoad: load,
      })),
    };
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

async function chooseVehicleResourceByRouteDuration(args: {
  requestedVehicleResourceId?: string;
  vehicleCandidates: PlannerVehicleCandidate[];
  sitePoint: SchedulePoint | null;
  candidatePoint: SchedulePoint;
  existingPointsByVehicleResourceId: (vehicleResourceId: string) => SchedulePoint[];
  estimateRoadTravel: ReturnType<typeof createRoadTravelEstimator>;
  travelMode: VisitRouteTravelMode;
}): Promise<
  | {
      ok: true;
      vehicleResource: PlannerVehicleResource | null;
      vehicleLoad: number;
      routeDurationMinutes: number | null;
    }
  | { ok: false; reasonCode: 'vehicle_route_duration'; detail: string }
> {
  if (args.vehicleCandidates.length === 0) {
    return { ok: true, vehicleResource: null, vehicleLoad: 0, routeDurationMinutes: null };
  }

  const rejectionDetails: string[] = [];
  for (const candidate of args.vehicleCandidates) {
    const maxRouteDurationMinutes = candidate.vehicleResource.max_route_duration_minutes;
    if (maxRouteDurationMinutes == null) {
      return {
        ok: true,
        vehicleResource: candidate.vehicleResource,
        vehicleLoad: candidate.vehicleLoad,
        routeDurationMinutes: null,
      };
    }

    const estimate = await computeBestRouteDurationWithCandidate(
      args.sitePoint,
      args.existingPointsByVehicleResourceId(candidate.vehicleResource.id),
      args.candidatePoint,
      args.estimateRoadTravel,
      args.travelMode,
    );
    if (estimate.durationMinutes == null) {
      rejectionDetails.push(
        `${candidate.vehicleResource.label} の稼働上限 ${maxRouteDurationMinutes}分を検証できません（${estimate.summary}）`,
      );
      continue;
    }
    if (estimate.durationMinutes <= maxRouteDurationMinutes) {
      return {
        ok: true,
        vehicleResource: candidate.vehicleResource,
        vehicleLoad: candidate.vehicleLoad,
        routeDurationMinutes: estimate.durationMinutes,
      };
    }
    rejectionDetails.push(
      `${candidate.vehicleResource.label} の候補追加後の推定稼働時間 ${estimate.durationMinutes.toFixed(1)}分 が上限 ${maxRouteDurationMinutes}分を超えます`,
    );
  }

  const detail = args.requestedVehicleResourceId
    ? (rejectionDetails[0] ?? '選択した車両の稼働時間上限を満たせません')
    : `利用可能な車両の稼働時間上限を満たせません（${rejectionDetails.slice(0, 3).join(' / ')}）`;
  return { ok: false, reasonCode: 'vehicle_route_duration', detail };
}

export async function generateVisitScheduleProposalDrafts(
  params: GenerateProposalParams,
): Promise<GenerateVisitScheduleProposalResult> {
  const travelMode = params.travelMode ?? 'DRIVE';
  const estimateRoadTravel = createRoadTravelEstimator(travelMode);
  // shift date / scheduled_date(@db.Date)比較用: ローカル日付の UTC 深夜に正規化する
  const planningStart = utcDateFromLocalKey(
    localDateKey(params.startDate ?? addDays(new Date(), 1)),
  );
  const lockedDate = params.lockedDate
    ? utcDateFromLocalKey(localDateKey(params.lockedDate))
    : null;

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
      overall_status: { notIn: ['cancelled', 'reported', 'on_hold', 'visit_completed'] },
    },
    orderBy: { updated_at: 'desc' },
    include: {
      prescription_intakes: {
        include: {
          lines: {
            select: {
              id: true,
              drug_master_id: true,
              drug_code: true,
              source_drug_code: true,
              drug_name: true,
              end_date: true,
              start_date: true,
              days: true,
              dosage_form: true,
              frequency: true,
              route: true,
              packaging_instruction_tags: true,
              packaging_instructions: true,
              notes: true,
              unit: true,
            },
          },
        },
      },
    },
  });

  const latestVisitSuggestion = await prisma.visitRecord.findFirst({
    where: {
      org_id: params.orgId,
      schedule: {
        org_id: params.orgId,
        case_id: params.caseId,
      },
    },
    select: {
      next_visit_suggestion_date: true,
    },
    orderBy: [{ visit_date: 'desc' }, { created_at: 'desc' }, { id: 'desc' }],
  });

  const planningStartDateKey = toDateKey(planningStart);
  const latestVisitSuggestionDate = latestVisitSuggestion?.next_visit_suggestion_date ?? null;
  const preliminaryDeadlinePolicy = resolveVisitDeadlinePolicy(cycle?.prescription_intakes, {
    nextVisitSuggestionDate: latestVisitSuggestionDate,
    planningStartDateKey,
    safetyBufferOperatingDays: 0,
  });
  const medicationEndDate = resolveEarliestMedicationEndDate(cycle?.prescription_intakes);
  const rawVisitDeadlineDate = preliminaryDeadlinePolicy.rawDeadlineDateKey
    ? utcDateFromLocalKey(preliminaryDeadlinePolicy.rawDeadlineDateKey)
    : null;
  const fallbackPlanningDeadlineDate = addUtcDays(planningStart, 14);
  const searchDeadlineDate = rawVisitDeadlineDate ?? fallbackPlanningDeadlineDate;
  const deadlineOverdue = searchDeadlineDate < planningStart;
  const planningEnd = lockedDate
    ? lockedDate
    : addUtcDays(
        planningStart,
        Math.min(
          MAX_SEARCH_DAYS,
          deadlineOverdue
            ? OVERDUE_ASAP_SEARCH_DAYS
            : Math.max(
                0,
                differenceInCalendarDays(searchDeadlineDate, planningStart) +
                  DEADLINE_POLICY_SCAN_BUFFER_DAYS,
              ),
        ),
      );
  const effectivePriority: VisitPriority =
    deadlineOverdue && params.priority === 'normal' ? 'urgent' : params.priority;

  const deadlinePolicyDiagnostics = new Map<string, ProposalDeadlinePolicyDiagnostic>();
  function addDeadlinePolicyDiagnostics(
    policy: VisitDeadlinePolicy,
    siteId: string | null | undefined,
  ) {
    for (const diagnostic of policy.diagnostics) {
      const entry: ProposalDeadlinePolicyDiagnostic = {
        ...diagnostic,
        site_id: siteId ?? null,
      };
      deadlinePolicyDiagnostics.set(JSON.stringify(entry), entry);
    }
  }
  addDeadlinePolicyDiagnostics(preliminaryDeadlinePolicy, null);

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

  const siteIds = Array.from(
    new Set(shifts.map((shift) => shift.site_id).filter((siteId): siteId is string => !!siteId)),
  );
  const [operatingWeeklyRows, holidays] = await Promise.all([
    prisma.pharmacyOperatingHours.findMany({
      where: {
        org_id: params.orgId,
        site_id: { in: siteIds },
      },
      select: {
        id: true,
        site_id: true,
        weekday: true,
        is_open: true,
        open_time: true,
        close_time: true,
        note: true,
      },
    }),
    prisma.businessHoliday.findMany({
      where: {
        org_id: params.orgId,
        date: {
          gte: planningStart,
          lte: planningEnd,
        },
        OR: [{ site_id: { in: siteIds } }, { site_id: null }],
      },
      select: {
        id: true,
        site_id: true,
        date: true,
        name: true,
        holiday_type: true,
        is_closed: true,
        open_time: true,
        close_time: true,
      },
    }),
  ]);

  const vehicleResourceWhere: Prisma.VisitVehicleResourceWhereInput = {
    org_id: params.orgId,
    available: true,
    ...(params.vehicleResourceId
      ? {
          OR: [
            { id: params.vehicleResourceId },
            ...(siteIds.length > 0 ? [{ site_id: { in: siteIds } }] : []),
          ],
        }
      : { site_id: { in: siteIds } }),
  };
  const vehicleResources = await prisma.visitVehicleResource.findMany({
    where: vehicleResourceWhere,
    select: {
      id: true,
      site_id: true,
      label: true,
      travel_mode: true,
      max_stops: true,
      max_route_duration_minutes: true,
    },
  });
  const operatingCalendarBySite = new Map<
    string,
    ReturnType<typeof buildOperatingCalendarFromDbRows>
  >();
  function operatingCalendarForSite(siteId: string | null) {
    const key = siteId ?? '';
    const existing = operatingCalendarBySite.get(key);
    if (existing) return existing;
    const calendar = buildOperatingCalendarFromDbRows(
      key,
      operatingWeeklyRows.filter((row) => row.site_id === key),
      holidays.filter((row) => row.site_id === null || row.site_id === key),
    );
    operatingCalendarBySite.set(key, calendar);
    return calendar;
  }

  function hasConfiguredOperatingCalendar(siteId: string | null) {
    const key = siteId ?? '';
    return (
      operatingWeeklyRows.some((row) => row.site_id === key) ||
      holidays.some((row) => row.site_id === null || row.site_id === key)
    );
  }

  const deadlinePolicyBySite = new Map<
    string,
    {
      policy: VisitDeadlinePolicy;
      cutoffDate: Date;
      visitDeadlineDate: Date | null;
      deadlineOverdue: boolean;
    }
  >();
  function resolveDeadlineForSite(siteId: string | null) {
    const key = siteId ?? '';
    const cached = deadlinePolicyBySite.get(key);
    if (cached) return cached;

    const policy = resolveVisitDeadlinePolicy(cycle?.prescription_intakes, {
      nextVisitSuggestionDate: latestVisitSuggestionDate,
      planningStartDateKey,
      operatingCalendar: operatingCalendarForSite(siteId),
      safetyBufferOperatingDays: hasConfiguredOperatingCalendar(siteId)
        ? DEADLINE_POLICY_SAFETY_BUFFER_OPERATING_DAYS
        : 0,
      maxScanDays: Math.max(
        366 * 2,
        differenceInCalendarDays(planningEnd, planningStart) + DEADLINE_POLICY_SCAN_BUFFER_DAYS,
      ),
    });
    addDeadlinePolicyDiagnostics(policy, siteId);
    const deadlineOverdue = Boolean(
      policy.rawDeadlineDateKey && policy.rawDeadlineDateKey < planningStartDateKey,
    );
    const visitDeadlineDate = policy.recommendedDeadlineDateKey
      ? utcDateFromLocalKey(
          deadlineOverdue
            ? (policy.rawDeadlineDateKey ?? policy.recommendedDeadlineDateKey)
            : policy.recommendedDeadlineDateKey,
        )
      : null;
    const resolved = {
      policy,
      cutoffDate: deadlineOverdue
        ? planningEnd
        : (visitDeadlineDate ?? fallbackPlanningDeadlineDate),
      visitDeadlineDate,
      deadlineOverdue,
    };
    deadlinePolicyBySite.set(key, resolved);
    return resolved;
  }

  const candidatePharmacistIds = Array.from(new Set(shifts.map((shift) => shift.user_id)));
  const candidateVehicleResourceIds = Array.from(
    new Set(vehicleResources.map((vehicle) => vehicle.id)),
  );
  const confirmedScheduleScope: Prisma.VisitScheduleWhereInput[] = [
    { case_: { patient_id: careCase.patient_id } },
    ...(candidatePharmacistIds.length > 0
      ? [{ pharmacist_id: { in: candidatePharmacistIds } }]
      : []),
    ...(siteIds.length > 0 ? [{ site_id: { in: siteIds } }] : []),
    ...(candidateVehicleResourceIds.length > 0
      ? [{ vehicle_resource_id: { in: candidateVehicleResourceIds } }]
      : []),
  ];

  const confirmedSchedules = await prisma.visitSchedule.findMany({
    where: {
      org_id: params.orgId,
      scheduled_date: {
        gte: planningStart,
        lte: planningEnd,
      },
      ...(params.rescheduleSourceScheduleId
        ? { id: { not: params.rescheduleSourceScheduleId } }
        : {}),
      schedule_status: {
        in: ACTIVE_BILLING_SCHEDULE_STATUSES,
      },
      OR: confirmedScheduleScope,
    },
    select: {
      pharmacist_id: true,
      vehicle_resource_id: true,
      route_order: true,
      scheduled_date: true,
      time_window_start: true,
      time_window_end: true,
      schedule_status: true,
      confirmed_at: true,
      priority: true,
      case_: {
        select: {
          patient: {
            select: {
              id: true,
              residences: {
                where: { is_primary: true },
                take: 1,
                select: {
                  address: true,
                  lat: true,
                  lng: true,
                  building_id: true,
                  facility_unit_id: true,
                },
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
    },
  });

  const confirmedSchedulesByDayAndPharmacist = new Map<string, typeof confirmedSchedules>();
  const confirmedSchedulesByWeekAndPharmacist = new Map<string, typeof confirmedSchedules>();
  const confirmedSchedulesByDay = new Map<string, typeof confirmedSchedules>();
  const confirmedSchedulesForPatient = confirmedSchedules.filter(
    (schedule) => schedule.case_.patient.id === careCase.patient_id,
  );
  const confirmedSchedulesForPatientByMonth = new Map<string, number>();
  const confirmedSchedulesForPatientByWeek = new Map<string, number>();
  for (const schedule of confirmedSchedulesForPatient) {
    incrementCount(confirmedSchedulesForPatientByMonth, buildMonthKey(schedule.scheduled_date));
    incrementCount(confirmedSchedulesForPatientByWeek, buildWeekKey(schedule.scheduled_date));
  }
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
    availabilityReasonCode?: VisitAvailabilityBlockedReason;
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
      ...(args.availabilityReasonCode
        ? { availability_reason_code: args.availabilityReasonCode }
        : {}),
    };
  }

  function scheduleToPoint(schedule: (typeof confirmedSchedules)[number]): SchedulePoint {
    return {
      routeOrder: schedule.route_order ?? null,
      lat: schedule.case_.patient.residences[0]?.lat ?? null,
      lng: schedule.case_.patient.residences[0]?.lng ?? null,
      address: schedule.case_.patient.residences[0]?.address ?? null,
      startsAt: schedule.time_window_start
        ? setTime(schedule.scheduled_date, schedule.time_window_start, DEFAULT_SHIFT_START)
        : null,
    };
  }

  const evaluatedCandidates = await mapWithConcurrency(
    shifts,
    normalizePlannerCandidateEvaluationConcurrency(process.env.VISIT_SCHEDULE_PLANNER_CONCURRENCY),
    async (shift) => {
      const deadlineForSite = resolveDeadlineForSite(shift.site_id ?? null);
      const shiftDateKey = toDateKey(shift.date);
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
      const baseAvailability = canVisitOn({
        calendar: operatingCalendarForSite(shift.site_id),
        dateKey: shiftDateKey,
        shift: {
          site_id: shift.site_id ?? null,
          available: shift.available,
          available_from: timeDateToString(shift.available_from) ?? null,
          available_to: timeDateToString(shift.available_to) ?? null,
        },
      });
      const operatingState = baseAvailability.canVisit
        ? baseAvailability.operatingState
        : resolveOperatingState(operatingCalendarForSite(shift.site_id), shiftDateKey);
      if (!baseAvailability.canVisit) {
        const canOverrideClosedDay =
          params.operatingDayOverrideReason &&
          (baseAvailability.reason === 'pharmacy_holiday' ||
            baseAvailability.reason === 'pharmacy_regular_closed');
        if (!canOverrideClosedDay) {
          return {
            kind: 'rejected' as const,
            diagnostic: buildRejectedDiagnostic({
              shift,
              reasonCode: baseAvailability.reason,
              detail: availabilityReasonDetail(baseAvailability.reason),
              availabilityReasonCode: baseAvailability.reason,
            }),
          };
        }
      }
      if (lockedDate && shift.date > deadlineForSite.cutoffDate) {
        const entry: ProposalDeadlinePolicyDiagnostic = {
          code: 'locked_date_deadline_violation',
          site_id: shift.site_id ?? null,
          date_key: toDateKey(shift.date),
          value: toDateKey(deadlineForSite.cutoffDate),
        };
        deadlinePolicyDiagnostics.set(JSON.stringify(entry), entry);
        return {
          kind: 'rejected' as const,
          diagnostic: buildRejectedDiagnostic({
            shift,
            reasonCode: 'locked_date_deadline_violation',
            detail: `固定日 ${toDateKey(shift.date)} は訪問期限 ${toDateKey(deadlineForSite.cutoffDate)} を超えるため候補外です`,
          }),
        };
      }
      if (shift.date > deadlineForSite.cutoffDate) {
        return {
          kind: 'rejected' as const,
          diagnostic: buildRejectedDiagnostic({
            shift,
            reasonCode: 'beyond_deadline',
            detail: `訪問期限 ${toDateKey(deadlineForSite.cutoffDate)} を超えるため候補外です`,
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
      if (effectivePriority === 'emergency' && !shift.user.can_accept_emergency) {
        return {
          kind: 'rejected' as const,
          diagnostic: buildRejectedDiagnostic({
            shift,
            reasonCode: 'emergency_capability',
            detail: 'この薬剤師は緊急訪問受入設定がありません',
          }),
        };
      }
      if (mergedVisitWindow == null) {
        return {
          kind: 'rejected' as const,
          diagnostic: buildRejectedDiagnostic({
            shift,
            reasonCode: 'no_slot',
            detail: '患者在宅時間帯と施設受入時間帯が重ならないため候補外です',
          }),
        };
      }
      const shiftVisitWindow = operatingState.open
        ? intersectWindows(mergedVisitWindow, {
            from: operatingState.from ?? undefined,
            to: operatingState.to ?? undefined,
          })
        : mergedVisitWindow;
      if (shiftVisitWindow == null) {
        return {
          kind: 'rejected' as const,
          diagnostic: buildRejectedDiagnostic({
            shift,
            reasonCode: 'outside_pharmacy_operating_window',
            detail: availabilityReasonDetail('outside_pharmacy_operating_window'),
            availabilityReasonCode: 'outside_pharmacy_operating_window',
          }),
        };
      }
      const operatingWindowApplied =
        operatingState.open && Boolean(operatingState.from || operatingState.to);

      try {
        const schedulesForDay = confirmedSchedulesByDay.get(shiftDateKey) ?? [];
        const schedulesForShift =
          confirmedSchedulesByDayAndPharmacist.get(`${shift.user_id}:${shiftDateKey}`) ?? [];
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
          existingSchedules: schedulesForDay,
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
        const sitePoint = shift.site
          ? {
              routeOrder: 0,
              lat: shift.site.lat,
              lng: shift.site.lng,
              address: shift.site.address,
              startsAt: null,
            }
          : null;
        const shiftStart = setTime(shift.date, shift.available_from, DEFAULT_SHIFT_START);
        const shiftEnd = setTime(shift.date, shift.available_to, DEFAULT_SHIFT_END);
        const slot = findAvailableSlot({
          baseDate: shift.date,
          shiftStart,
          shiftEnd,
          preferredTimeFrom: shiftVisitWindow.from,
          preferredTimeTo: shiftVisitWindow.to,
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
        const candidatePointForSlot: SchedulePoint = {
          ...candidatePoint,
          startsAt: slot.start,
        };
        const vehicleRouteSelection = await chooseVehicleResourceByRouteDuration({
          requestedVehicleResourceId: params.vehicleResourceId,
          vehicleCandidates: vehicleSelection.vehicleCandidates,
          sitePoint,
          candidatePoint: candidatePointForSlot,
          existingPointsByVehicleResourceId: (vehicleResourceId) =>
            schedulesForDay
              .filter((schedule) => schedule.vehicle_resource_id === vehicleResourceId)
              .map(scheduleToPoint),
          estimateRoadTravel,
          travelMode,
        });
        if (!vehicleRouteSelection.ok) {
          return {
            kind: 'rejected' as const,
            diagnostic: buildRejectedDiagnostic({
              shift,
              reasonCode: vehicleRouteSelection.reasonCode,
              detail: vehicleRouteSelection.detail,
            }),
          };
        }

        const routeInsertion = await computeRouteInsertion(
          sitePoint,
          schedulesForShift.map(scheduleToPoint),
          candidatePointForSlot,
          estimateRoadTravel,
          travelMode,
        );
        if (
          shift.user.max_travel_minutes != null &&
          routeInsertion.travelLimitMinutes != null &&
          routeInsertion.travelLimitMinutes > shift.user.max_travel_minutes
        ) {
          return {
            kind: 'rejected' as const,
            diagnostic: buildRejectedDiagnostic({
              shift,
              reasonCode: 'travel_limit',
              detail: `移動負荷 ${routeInsertion.travelLimitMinutes.toFixed(1)}分 が上限 ${shift.user.max_travel_minutes}分を超えます`,
            }),
          };
        }
        if (shift.user.max_travel_minutes != null && routeInsertion.travelLimitMinutes == null) {
          return {
            kind: 'rejected' as const,
            diagnostic: buildRejectedDiagnostic({
              shift,
              reasonCode: 'travel_limit_unverified',
              detail: `移動上限 ${shift.user.max_travel_minutes}分を検証できないため、住所座標を整備してから提案してください`,
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
          effectivePriority === 'emergency' ? -20 : effectivePriority === 'urgent' ? -10 : 0;
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
          effectivePriority === 'emergency'
            ? remainingSlackMinutes < DEFAULT_VISIT_DURATION_MINUTES
              ? 18
              : 0
            : remainingSlackMinutes < DEFAULT_VISIT_DURATION_MINUTES * 2
              ? 6
              : 0;
        const monthlyCountForCandidate =
          confirmedSchedulesForPatientByMonth.get(buildMonthKey(shift.date)) ?? 0;
        const weeklyCountForCandidate =
          weeklyCap == null
            ? 0
            : (confirmedSchedulesForPatientByWeek.get(buildWeekKey(shift.date)) ?? 0);
        const cadencePenalty =
          (monthlyCountForCandidate >= monthlyCap ? 120 : 0) +
          (weeklyCap != null && weeklyCountForCandidate >= weeklyCap ? 80 : 0);
        const vehiclePenalty = vehicleRouteSelection.vehicleResource
          ? vehicleRouteSelection.vehicleLoad * 3
          : 0;
        const specialtyCoverage = assessSpecialtyCoverage({
          specialProcedures,
          visitSpecialties: shift.user.visit_specialties,
        });
        const specialtyPenalty = specialtyCoverage.penalty;
        const scoreBreakdown: CandidateScoreBreakdown = {
          geocodePenalty,
          facilityBonus,
          workloadPenalty,
          slackPenalty,
          lockPenalty,
          cadencePenalty,
          vehiclePenalty,
          specialtyPenalty,
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
          scoreBreakdown.specialtyPenalty +
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
          visitWindow: shiftVisitWindow,
          operatingWindowApplied,
          specialtyCoverage,
          vehicleResource: vehicleRouteSelection.vehicleResource,
          vehicleLoad: vehicleRouteSelection.vehicleLoad,
          visitDeadlineDate: deadlineForSite.visitDeadlineDate,
          deadlineOverdue: deadlineForSite.deadlineOverdue,
          priorityAwareRouteOrder: resolvePriorityAwareRouteOrder({
            baseRouteOrder: routeInsertion.routeOrder,
            priority: effectivePriority,
            existingSchedules: schedulesForShift,
          }),
        };
      } catch {
        return {
          kind: 'rejected' as const,
          diagnostic: buildRejectedDiagnostic({
            shift,
            reasonCode: 'evaluation_error',
            detail: '評価中にエラーが発生しました',
          }),
        };
      }
    },
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
    priority: effectivePriority,
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
    visit_deadline_date: candidate.visitDeadlineDate,
    proposal_reason: buildReason({
      medicationEndDate,
      visitDeadlineDate: candidate.visitDeadlineDate,
      deadlineOverdue: candidate.deadlineOverdue,
      routeOrder,
      assignmentMode: candidate.assignmentMode,
      careRelationship: candidate.careRelationship,
      isEmergencyPriority: effectivePriority === 'emergency',
      travelScore: candidate.routeInsertion.travelScore,
      travelSummary: candidate.routeInsertion.travelSummary,
      constraintSummary: [
        ...(candidate.deadlineOverdue ? ['服薬期限超過のため最短候補として評価'] : []),
        ...(candidate.visitWindow.from || candidate.visitWindow.to
          ? [
              `訪問可能時間 ${candidate.visitWindow.from ?? '09:00'}-${candidate.visitWindow.to ?? '18:00'} 内で配置`,
            ]
          : []),
        ...(candidate.operatingWindowApplied ? ['薬局営業時間を反映'] : []),
        ...(candidate.scoreBreakdown.geocodePenalty > 0
          ? ['住所座標未整備のため補正スコアを適用']
          : []),
        ...(candidate.scoreBreakdown.cadencePenalty > 0
          ? ['算定間隔・回数制限に近いため後方候補として評価']
          : ['算定間隔・回数上は提案可能日']),
        ...(candidate.specialtyCoverage.unknownProcedureCount > 0
          ? ['専門対応 未定義手技は要確認のため後方評価']
          : candidate.specialtyCoverage.missingLabels.length > 0
            ? [
                `登録上の専門対応候補 ${candidate.specialtyCoverage.missingLabels.join('・')} は未一致のため後方評価`,
              ]
            : candidate.specialtyCoverage.requiredLabels.length > 0
              ? [
                  `登録上の専門対応候補 ${candidate.specialtyCoverage.requiredLabels.join('・')} と照合`,
                ]
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
      specialty_coverage: specialtyCoverageDiagnostic(candidate.specialtyCoverage),
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
      deadline_policy: Array.from(deadlinePolicyDiagnostics.values()),
    },
  };
}
