import { Prisma, type PrismaClient } from '@prisma/client';
import { buildSort } from '@/lib/api/search';
import {
  canAccessVisitScheduleAssignment,
  buildVisitScheduleAssignmentWhere,
  type VisitScheduleAccessContext,
} from '@/lib/auth/visit-schedule-access';
import { withOrgContext } from '@/lib/db/rls';
import { buildScheduleListInclude } from '@/lib/db/schedule-includes';
import { ACTIVE_VISIT_SCHEDULE_STATUSES } from '@/lib/constants/visit';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { conflict, forbiddenResponse, validationError } from '@/lib/api/response';
import { hhmmToTimeDate } from '@/lib/datetime/time-of-day';
import { applyTimeDateToDate, timeDateToString } from '@/lib/visits/time-of-day';
import {
  OPEN_VISIT_SCHEDULE_PROPOSAL_STATUSES,
  allocateProposalRouteOrders,
} from '@/lib/visit-schedule-proposals/route-order';
import { enrichSchedulesWithHints } from '@/server/services/schedule-enrichment';
import {
  evaluateVisitWorkflowGate,
  formatVisitWorkflowGateIssues,
} from '@/server/services/management-plans';
import { attachVisitSchedulePatientSummary } from '@/server/services/visit-schedule-patient-summary';
import { validateVisitScheduleBlockingBillingRequirements } from '@/server/services/visit-schedule-billing-guard';
import { validateScheduleTimeStringsFitShift } from '@/server/services/visit-schedule-shift';
import { createRoadTravelEstimator } from '@/server/services/road-routing';
import {
  estimateVehicleRouteDurationWithCandidate,
  type VehicleRouteDurationPoint,
} from '@/server/services/visit-schedule-planner';
import type { VisitRouteTravelMode } from '@/types/visit-route';
import type { z } from 'zod';
import type { createVisitScheduleSchema } from '@/lib/validations/visit-schedule';

type CreateScheduleData = z.infer<typeof createVisitScheduleSchema>;
const DEFAULT_ROUTE_DURATION_START = '09:00';

const CREATE_SCHEDULE_SERIALIZABLE_RETRY_LIMIT = 3;

class VisitScheduleCreateRetryLimitError extends Error {
  constructor() {
    super('visit schedule creation transaction retry limit exceeded');
    this.name = 'VisitScheduleCreateRetryLimitError';
  }
}

function isSerializableTransactionConflict(cause: unknown) {
  return cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2034';
}

async function withSerializableScheduleCreateTransaction<T>(
  orgId: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  for (let attempt = 0; attempt < CREATE_SCHEDULE_SERIALIZABLE_RETRY_LIMIT; attempt += 1) {
    try {
      return await withOrgContext(orgId, work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (cause) {
      if (!isSerializableTransactionConflict(cause)) {
        throw cause;
      }
      if (attempt === CREATE_SCHEDULE_SERIALIZABLE_RETRY_LIMIT - 1) {
        throw new VisitScheduleCreateRetryLimitError();
      }
    }
  }

  throw new VisitScheduleCreateRetryLimitError();
}

type VisitVehicleResourceValidationArgs = {
  orgId: string;
  vehicleResourceId: string;
  siteId: string | null;
  scheduledDate: Date;
  excludeScheduleId?: string;
  routeDurationContext?: {
    candidatePoint: VehicleRouteDurationPoint;
  };
};

type VisitVehicleResourceValidationDb =
  | Pick<PrismaClient, 'visitSchedule' | 'visitVehicleResource'>
  | Pick<Prisma.TransactionClient, 'visitSchedule' | 'visitVehicleResource'>;

type VisitScheduleTimeConflictDb =
  | Pick<PrismaClient, 'visitSchedule'>
  | Pick<Prisma.TransactionClient, 'visitSchedule'>;

export type VisitScheduleTimeConflictKind = 'pharmacist_overlap' | 'vehicle_overlap';

type VisitScheduleTimeConflictArgs = {
  orgId: string;
  scheduledDate: Date;
  pharmacistId: string;
  timeWindowStart: Date | null;
  timeWindowEnd: Date | null;
  vehicleResourceId?: string | null;
  excludeScheduleId?: string;
};

type PreferenceWindow = {
  from?: string;
  to?: string;
};

export function isActiveVisitScheduleStatus(status: string) {
  return (ACTIVE_VISIT_SCHEDULE_STATUSES as readonly string[]).includes(status);
}

export type ListSchedulesFilters = {
  cursor?: string;
  limit?: number;
  date_from?: string;
  date_to?: string;
  status_scope?: 'active';
  pharmacist_id?: string;
  case_id?: string;
  patient_id?: string;
  sort?: 'scheduled_date' | 'time_window_start' | 'priority' | 'created_at';
  order?: 'asc' | 'desc';
};

export async function listSchedules(
  prisma: PrismaClient,
  orgId: string,
  filters: ListSchedulesFilters,
  accessContext?: VisitScheduleAccessContext,
) {
  const cursor = filters.cursor;
  const limit = filters.limit ?? 50;
  const primarySort = buildSort(
    filters.sort,
    filters.order,
    ['scheduled_date', 'time_window_start', 'priority', 'created_at'],
    'scheduled_date',
  );

  const assignmentWhere = accessContext ? buildVisitScheduleAssignmentWhere(accessContext) : null;
  const where = {
    org_id: orgId,
    ...(filters.date_from || filters.date_to
      ? {
          scheduled_date: {
            ...(filters.date_from ? { gte: new Date(filters.date_from) } : {}),
            ...(filters.date_to ? { lte: new Date(filters.date_to) } : {}),
          },
        }
      : {}),
    ...(filters.status_scope === 'active'
      ? {
          schedule_status: {
            in: [...ACTIVE_VISIT_SCHEDULE_STATUSES],
          },
        }
      : {}),
    ...(filters.pharmacist_id ? { pharmacist_id: filters.pharmacist_id } : {}),
    ...(filters.case_id ? { case_id: filters.case_id } : {}),
    ...(filters.patient_id ? { case_: { patient_id: filters.patient_id } } : {}),
    ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
  };

  const schedules = await prisma.visitSchedule.findMany({
    where,
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy:
      filters.sort === 'time_window_start'
        ? [primarySort ?? { time_window_start: 'asc' }, { scheduled_date: 'asc' }, { id: 'asc' }]
        : [primarySort ?? { scheduled_date: 'asc' }, { time_window_start: 'asc' }, { id: 'asc' }],
    include: buildScheduleListInclude(orgId),
  });

  const hasMore = schedules.length > limit;
  const data = hasMore ? schedules.slice(0, limit) : schedules;

  return {
    data: enrichSchedulesWithHints(data).map(attachVisitSchedulePatientSummary),
    hasMore,
    nextCursor: hasMore ? data[data.length - 1]?.id : undefined,
  };
}

export async function validateVisitVehicleResourceForSchedule(
  prisma: VisitVehicleResourceValidationDb,
  args: VisitVehicleResourceValidationArgs,
) {
  const vehicleResource = await prisma.visitVehicleResource.findFirst({
    where: {
      org_id: args.orgId,
      id: args.vehicleResourceId,
      available: true,
    },
    select: {
      id: true,
      site_id: true,
      label: true,
      max_stops: true,
      max_route_duration_minutes: true,
      travel_mode: true,
      site: {
        select: {
          address: true,
          lat: true,
          lng: true,
        },
      },
    },
  });
  if (!vehicleResource) {
    return {
      ok: false as const,
      response: validationError('選択した車両リソースが見つからないか利用できません'),
    };
  }
  if (!args.siteId) {
    return {
      ok: false as const,
      response: validationError('車両リソースを指定する場合は訪問拠点が必要です'),
    };
  }
  if (vehicleResource.site_id !== args.siteId) {
    return {
      ok: false as const,
      response: validationError('選択した車両リソースは訪問予定の拠点では利用できません'),
    };
  }
  if (vehicleResource.max_stops != null) {
    const sameCellScheduleCount = await prisma.visitSchedule.count({
      where: {
        org_id: args.orgId,
        ...(args.excludeScheduleId ? { id: { not: args.excludeScheduleId } } : {}),
        vehicle_resource_id: args.vehicleResourceId,
        scheduled_date: args.scheduledDate,
        schedule_status: {
          notIn: ['cancelled', 'rescheduled'],
        },
      },
    });
    if (sameCellScheduleCount + 1 > vehicleResource.max_stops) {
      return {
        ok: false as const,
        response: validationError(
          `${vehicleResource.label} で訪問できる件数は最大 ${vehicleResource.max_stops} 件です`,
        ),
      };
    }
  }
  if (vehicleResource.max_route_duration_minutes != null) {
    const sitePoint = buildSiteRoutePoint(vehicleResource.site);
    if (!args.routeDurationContext || !sitePoint) {
      return {
        ok: false as const,
        response: validationError(
          `${vehicleResource.label} の稼働上限 ${vehicleResource.max_route_duration_minutes}分を検証できません。訪問拠点の住所座標を整備してください`,
        ),
      };
    }

    const existingSchedules = await prisma.visitSchedule.findMany({
      where: {
        org_id: args.orgId,
        ...(args.excludeScheduleId ? { id: { not: args.excludeScheduleId } } : {}),
        vehicle_resource_id: args.vehicleResourceId,
        scheduled_date: args.scheduledDate,
        schedule_status: {
          notIn: ['cancelled', 'rescheduled'],
        },
      },
      select: {
        route_order: true,
        time_window_start: true,
        case_: {
          select: {
            patient: {
              select: {
                residences: {
                  where: { is_primary: true },
                  take: 1,
                  select: {
                    address: true,
                    lat: true,
                    lng: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    const existingPoints = existingSchedules.map((schedule) =>
      buildVehicleRoutePoint({
        scheduledDate: args.scheduledDate,
        routeOrder: schedule.route_order,
        timeWindowStart: schedule.time_window_start,
        residence: schedule.case_.patient.residences[0] ?? null,
      }),
    );
    const estimate = await estimateVehicleRouteDurationWithCandidate(
      sitePoint,
      existingPoints,
      args.routeDurationContext.candidatePoint,
      createRoadTravelEstimator(vehicleResource.travel_mode as VisitRouteTravelMode),
      vehicleResource.travel_mode as VisitRouteTravelMode,
    );
    if (estimate.durationMinutes == null) {
      return {
        ok: false as const,
        response: validationError(
          `${vehicleResource.label} の稼働上限 ${vehicleResource.max_route_duration_minutes}分を検証できません（${estimate.summary}）`,
        ),
      };
    }
    if (estimate.durationMinutes > vehicleResource.max_route_duration_minutes) {
      return {
        ok: false as const,
        response: validationError(
          `${vehicleResource.label} の候補追加後の推定稼働時間 ${estimate.durationMinutes.toFixed(1)}分 が上限 ${vehicleResource.max_route_duration_minutes}分を超えます`,
        ),
      };
    }
  }

  return { ok: true as const, vehicleResource };
}

export function buildVehicleRoutePoint(args: {
  scheduledDate: Date;
  routeOrder: number | null;
  timeWindowStart: Date | null;
  residence: { address: string | null; lat: number | null; lng: number | null } | null;
}): VehicleRouteDurationPoint {
  return {
    routeOrder: args.routeOrder,
    lat: args.residence?.lat ?? null,
    lng: args.residence?.lng ?? null,
    address: args.residence?.address ?? null,
    startsAt: args.timeWindowStart
      ? applyTimeDateToDate(args.scheduledDate, args.timeWindowStart, DEFAULT_ROUTE_DURATION_START)
      : null,
  };
}

function buildSiteRoutePoint(
  site:
    | {
        address: string | null;
        lat: number | null;
        lng: number | null;
      }
    | null
    | undefined,
): VehicleRouteDurationPoint | null {
  if (!site) return null;
  return {
    routeOrder: 0,
    lat: site.lat,
    lng: site.lng,
    address: site.address,
    startsAt: null,
  };
}

export async function findVisitScheduleTimeConflict(
  prisma: VisitScheduleTimeConflictDb,
  args: VisitScheduleTimeConflictArgs,
) {
  if (!args.timeWindowStart || !args.timeWindowEnd) return null;

  const baseWhere: Prisma.VisitScheduleWhereInput = {
    org_id: args.orgId,
    ...(args.excludeScheduleId ? { id: { not: args.excludeScheduleId } } : {}),
    scheduled_date: args.scheduledDate,
    schedule_status: {
      in: [...ACTIVE_VISIT_SCHEDULE_STATUSES],
    },
    time_window_start: { lt: args.timeWindowEnd },
    time_window_end: { gt: args.timeWindowStart },
  };

  const pharmacistConflict = await prisma.visitSchedule.findFirst({
    where: {
      ...baseWhere,
      pharmacist_id: args.pharmacistId,
    },
    select: { id: true },
  });
  if (pharmacistConflict) {
    return {
      kind: 'pharmacist_overlap' as const,
      scheduleId: pharmacistConflict.id,
    };
  }

  if (!args.vehicleResourceId) return null;
  const vehicleConflict = await prisma.visitSchedule.findFirst({
    where: {
      ...baseWhere,
      vehicle_resource_id: args.vehicleResourceId,
    },
    select: { id: true },
  });
  if (vehicleConflict) {
    return {
      kind: 'vehicle_overlap' as const,
      scheduleId: vehicleConflict.id,
    };
  }

  return null;
}

export function getVisitScheduleTimeConflictMessage(kind: VisitScheduleTimeConflictKind) {
  if (kind === 'vehicle_overlap') {
    return '同一車両・同一日付の訪問時間帯が既存予定と重複しています。再読み込みしてください';
  }
  return '同一薬剤師・同一日付の訪問時間帯が既存予定と重複しています。再読み込みしてください';
}

export async function createSchedule(
  prisma: PrismaClient,
  orgId: string,
  userId: string,
  data: CreateScheduleData,
  accessContext: VisitScheduleAccessContext,
) {
  const {
    site_id,
    priority,
    scheduled_date,
    time_window_start,
    time_window_end,
    vehicle_resource_id,
    notes: _notes,
    ...rest
  } = data;
  void _notes;
  const scheduledDate = new Date(scheduled_date);
  const shift = await prisma.pharmacistShift.findFirst({
    where: {
      org_id: orgId,
      user_id: rest.pharmacist_id,
      date: scheduledDate,
    },
    select: {
      site_id: true,
      available: true,
      available_from: true,
      available_to: true,
    },
  });
  if (!shift) {
    return validationError('選択した薬剤師のシフトがありません');
  }
  const shiftValidationError = validateScheduleTimeStringsFitShift(
    shift,
    time_window_start,
    time_window_end,
  );
  if (shiftValidationError) {
    return validationError(shiftValidationError);
  }
  const effectiveSiteId = site_id ?? shift?.site_id ?? null;

  const refResult = await validateOrgReferences(orgId, {
    case_id: rest.case_id,
    ...(rest.cycle_id ? { cycle_id: rest.cycle_id } : {}),
    pharmacist_id: rest.pharmacist_id,
    ...(effectiveSiteId ? { site_id: effectiveSiteId } : {}),
  });
  if (!refResult.ok) return refResult.response;

  const careCase = await prisma.careCase.findFirst({
    where: { id: rest.case_id, org_id: orgId },
    select: {
      patient_id: true,
      primary_pharmacist_id: true,
      backup_pharmacist_id: true,
      required_visit_support: true,
      patient: {
        select: {
          scheduling_preference: true,
          residences: {
            where: { is_primary: true },
            take: 1,
            select: {
              facility_unit_id: true,
              address: true,
              lat: true,
              lng: true,
              facility: {
                select: {
                  acceptance_time_from: true,
                  acceptance_time_to: true,
                  regular_visit_weekdays: true,
                },
              },
            },
          },
        },
      },
    },
  });
  if (!careCase) {
    return validationError('ケースが見つかりません');
  }
  if (
    !canAccessVisitScheduleAssignment(accessContext, {
      pharmacist_id: rest.pharmacist_id,
      case_: careCase,
    })
  ) {
    return forbiddenResponse('このケースまたは担当薬剤師で訪問予定を作成する権限がありません');
  }

  const gate = await evaluateVisitWorkflowGate(prisma, {
    orgId,
    patientId: careCase.patient_id,
    caseId: rest.case_id,
    asOf: new Date(scheduled_date),
  });
  if (!gate.ok) {
    return validationError(formatVisitWorkflowGateIssues(gate.issues));
  }

  const preferenceValidationError = validateManualSchedulePreferences({
    scheduledDate,
    timeWindowStart: time_window_start,
    timeWindowEnd: time_window_end,
    schedulingPreference: careCase.patient.scheduling_preference,
    facility: careCase.patient.residences[0]?.facility ?? null,
  });
  if (preferenceValidationError) {
    return validationError(preferenceValidationError);
  }

  const facilityUnitId = careCase.patient?.residences[0]?.facility_unit_id ?? null;
  const targetTimeWindowStart = time_window_start ? hhmmToTimeDate(time_window_start) : null;
  const targetTimeWindowEnd = time_window_end ? hhmmToTimeDate(time_window_end) : null;
  const routeDurationContext = {
    candidatePoint: buildVehicleRoutePoint({
      scheduledDate,
      routeOrder: null,
      timeWindowStart: targetTimeWindowStart,
      residence: careCase.patient.residences[0] ?? null,
    }),
  };

  if (vehicle_resource_id) {
    const vehicleValidation = await validateVisitVehicleResourceForSchedule(prisma, {
      orgId,
      vehicleResourceId: vehicle_resource_id,
      siteId: effectiveSiteId,
      scheduledDate,
      routeDurationContext,
    });
    if (!vehicleValidation.ok) return vehicleValidation.response;
  }

  const result = await withSerializableScheduleCreateTransaction(orgId, async (tx) => {
    const duplicateSchedule = await tx.visitSchedule.findFirst({
      where: {
        org_id: orgId,
        case_id: rest.case_id,
        visit_type: rest.visit_type,
        scheduled_date: scheduledDate,
        schedule_status: { notIn: ['cancelled', 'rescheduled'] },
      },
      select: { id: true },
    });
    if (duplicateSchedule) {
      return {
        error: 'duplicate_schedule' as const,
      };
    }

    const duplicateOpenProposal = await tx.visitScheduleProposal.findFirst({
      where: {
        org_id: orgId,
        case_id: rest.case_id,
        visit_type: rest.visit_type,
        proposed_date: scheduledDate,
        finalized_schedule_id: null,
        proposal_status: { in: OPEN_VISIT_SCHEDULE_PROPOSAL_STATUSES },
      },
      select: { id: true },
    });
    if (duplicateOpenProposal) {
      return {
        error: 'duplicate_open_proposal' as const,
      };
    }

    const timeConflict = await findVisitScheduleTimeConflict(tx, {
      orgId,
      scheduledDate,
      pharmacistId: rest.pharmacist_id,
      timeWindowStart: targetTimeWindowStart,
      timeWindowEnd: targetTimeWindowEnd,
      vehicleResourceId: vehicle_resource_id ?? null,
    });
    if (timeConflict) {
      return {
        error: 'time_conflict' as const,
        conflictKind: timeConflict.kind,
      };
    }

    if (vehicle_resource_id) {
      const vehicleValidation = await validateVisitVehicleResourceForSchedule(tx, {
        orgId,
        vehicleResourceId: vehicle_resource_id,
        siteId: effectiveSiteId,
        scheduledDate,
        routeDurationContext,
      });
      if (!vehicleValidation.ok) {
        return {
          error: 'vehicle_resource_invalid' as const,
          response: vehicleValidation.response,
        };
      }
    }

    const billingValidation = await validateVisitScheduleBlockingBillingRequirements({
      db: tx,
      orgId,
      caseId: rest.case_id,
      patientId: careCase.patient_id,
      pharmacistId: rest.pharmacist_id,
      visitType: rest.visit_type,
      proposedDate: scheduledDate,
      requiredVisitSupport: careCase.required_visit_support,
      workflowPrevalidated: true,
    });
    if (billingValidation.blockingMessages.length > 0) {
      return {
        error: 'billing_cap_exceeded' as const,
        message: billingValidation.blockingMessages.join(' / '),
      };
    }

    const [routeOrderDraft] = await allocateProposalRouteOrders(tx, {
      orgId,
      drafts: [
        {
          proposed_pharmacist_id: rest.pharmacist_id,
          proposed_date: scheduledDate,
          route_order: 1,
        },
      ],
    });

    return tx.visitSchedule.create({
      data: {
        org_id: orgId,
        site_id: effectiveSiteId,
        vehicle_resource_id: vehicle_resource_id ?? null,
        priority: priority ?? 'normal',
        facility_unit_id: facilityUnitId,
        assignment_mode:
          careCase?.primary_pharmacist_id && careCase.primary_pharmacist_id === rest.pharmacist_id
            ? 'primary'
            : 'fallback',
        scheduled_date: scheduledDate,
        ...(targetTimeWindowStart ? { time_window_start: targetTimeWindowStart } : {}),
        ...(targetTimeWindowEnd ? { time_window_end: targetTimeWindowEnd } : {}),
        confirmed_at: new Date(),
        confirmed_by: userId,
        route_order: routeOrderDraft?.route_order ?? 1,
        ...rest,
      },
    });
  }).catch((cause: unknown) => {
    if (cause instanceof VisitScheduleCreateRetryLimitError) {
      return { error: 'serialization_conflict' as const };
    }
    throw cause;
  });

  if ('error' in result) {
    if (result.error === 'duplicate_schedule') {
      return conflict('同一ケース・同一日付の訪問予定が既に存在します。再読み込みしてください');
    }
    if (result.error === 'duplicate_open_proposal') {
      return conflict(
        '同一ケース・同一日付の未確定候補が既に存在します。既存候補を確認してください',
      );
    }
    if (result.error === 'billing_cap_exceeded') return validationError(result.message);
    if (result.error === 'time_conflict') {
      return conflict(getVisitScheduleTimeConflictMessage(result.conflictKind));
    }
    if (result.error === 'vehicle_resource_invalid') return result.response;
    return conflict('訪問予定の作成が同時に更新されました。再読み込みしてください');
  }

  return result;
}

function readTimeString(value: Date | null | undefined) {
  return timeDateToString(value);
}

function intersectWindows(...windows: Array<PreferenceWindow | null | undefined>) {
  let from: string | undefined;
  let to: string | undefined;

  for (const window of windows) {
    if (!window) continue;
    if (window.from && (!from || window.from > from)) from = window.from;
    if (window.to && (!to || window.to < to)) to = window.to;
  }

  if (from && to && from >= to) return null;
  return { from, to };
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

export function validateManualSchedulePreferences(args: {
  scheduledDate: Date;
  timeWindowStart?: string;
  timeWindowEnd?: string;
  schedulingPreference:
    | {
        preferred_weekdays: unknown;
        preferred_time_from: Date | null;
        preferred_time_to: Date | null;
        facility_time_from: Date | null;
        facility_time_to: Date | null;
      }
    | null
    | undefined;
  facility:
    | {
        acceptance_time_from: Date | null;
        acceptance_time_to: Date | null;
        regular_visit_weekdays: unknown;
      }
    | null
    | undefined;
}) {
  const preferredWeekdays = normalizeWeekdays(args.schedulingPreference?.preferred_weekdays);
  const facilityWeekdays = normalizeWeekdays(args.facility?.regular_visit_weekdays);
  const effectiveWeekdays = preferredWeekdays.length > 0 ? preferredWeekdays : facilityWeekdays;
  if (effectiveWeekdays.length > 0 && !effectiveWeekdays.includes(args.scheduledDate.getUTCDay())) {
    return '患者または施設の訪問希望曜日と一致しない日付です';
  }

  const mergedWindow = intersectWindows(
    {
      from: readTimeString(args.schedulingPreference?.preferred_time_from),
      to: readTimeString(args.schedulingPreference?.preferred_time_to),
    },
    {
      from: readTimeString(args.schedulingPreference?.facility_time_from),
      to: readTimeString(args.schedulingPreference?.facility_time_to),
    },
    {
      from: readTimeString(args.facility?.acceptance_time_from),
      to: readTimeString(args.facility?.acceptance_time_to),
    },
  );
  if (mergedWindow == null) {
    return '患者在宅時間帯と施設受入時間帯が重ならないため訪問枠を確定できません';
  }

  if (mergedWindow.from && !args.timeWindowStart) {
    return `訪問開始時刻を患者または施設の希望開始時刻 ${mergedWindow.from} 以降で指定してください`;
  }
  if (mergedWindow.to && !args.timeWindowEnd) {
    return `訪問終了時刻を患者または施設の希望終了時刻 ${mergedWindow.to} 以前で指定してください`;
  }
  if (args.timeWindowStart && mergedWindow.from && args.timeWindowStart < mergedWindow.from) {
    return `訪問開始時刻が患者または施設の希望開始時刻 ${mergedWindow.from} より前です`;
  }
  if (args.timeWindowEnd && mergedWindow.to && args.timeWindowEnd > mergedWindow.to) {
    return `訪問終了時刻が患者または施設の希望終了時刻 ${mergedWindow.to} を超えています`;
  }

  return null;
}
