import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { Prisma } from '@prisma/client';
import { requireAuthContext, type AuthContext } from '@/lib/auth/context';
import {
  canAccessVisitScheduleAssignment,
  canBypassVisitScheduleAssignmentAccess,
  canManageVisitScheduleLifecycle,
} from '@/lib/auth/visit-schedule-access';
import { z } from 'zod';
import {
  readJsonObjectRequestBody,
  readOptionalJsonObjectRequestBody,
} from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { hhmmToTimeDate } from '@/lib/datetime/time-of-day';
import { timeDateToString } from '@/lib/visits/time-of-day';
import {
  VISIT_SCHEDULE_CANCEL_REASON_CODES,
  visitScheduleCancelReasonLabel,
} from '@/lib/visits/schedule-reason';
import { formatUtcDateKey } from '@/lib/date-key';
import { withOrgContext } from '@/lib/db/rls';
import { buildScheduleDetailInclude } from '@/lib/db/schedule-includes';
import {
  success,
  validationError,
  notFound,
  forbiddenResponse,
  conflict,
  internalError,
} from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { updateVisitScheduleSchema, type ScheduleStatus } from '@/lib/validations/visit-schedule';
import { findVisitRouteOrderConflict } from '@/lib/visits/route-order-conflicts';
import { prisma } from '@/lib/db/client';
import { resolveOperationalTasks } from '@/server/services/operational-tasks';
import { attachVisitSchedulePatientSummary } from '@/server/services/visit-schedule-patient-summary';
import { validateScheduleTimeStringsFitShift } from '@/server/services/visit-schedule-shift';
import {
  findVisitScheduleTimeConflict,
  buildVehicleRoutePoint,
  getVisitScheduleTimeConflictMessage,
  isActiveVisitScheduleStatus,
  validateManualSchedulePreferences,
  validateVisitVehicleResourceForSchedule,
} from '@/server/services/visit-schedule-service';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import {
  evaluateVisitScheduleReadyTransition,
  getVisitReadyTransitionErrorMessage,
  sanitizeVisitReadyTransitionDetails,
} from '@/server/services/visit-preparation-readiness';

const VISIT_SCHEDULE_PATCH_SERIALIZABLE_RETRY_LIMIT = 3;
const ROUTE_REORDERABLE_STATUSES = new Set<ScheduleStatus>([
  'planned',
  'in_preparation',
  'ready',
  'departed',
  'in_progress',
]);

class VisitSchedulePatchRetryLimitError extends Error {
  constructor() {
    super('visit schedule patch transaction retry limit exceeded');
    this.name = 'VisitSchedulePatchRetryLimitError';
  }
}

function isSerializableTransactionConflict(cause: unknown) {
  return cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2034';
}

function schedulePatchAuditChanges(
  from: {
    case_id: string;
    site_id: string | null;
    visit_type: string;
    priority: string;
    scheduled_date: Date;
    time_window_start: Date | null;
    time_window_end: Date | null;
    pharmacist_id: string;
    vehicle_resource_id: string | null;
    schedule_status: string;
    route_order: number | null;
    recurrence_rule: string | null;
  },
  to: {
    case_id: string;
    site_id: string | null;
    visit_type: string;
    priority: string;
    scheduled_date: Date;
    time_window_start: Date | null;
    time_window_end: Date | null;
    pharmacist_id: string;
    vehicle_resource_id: string | null;
    schedule_status: string;
    route_order: number | null;
    recurrence_rule: string | null;
  },
) {
  const changes: Record<string, { from: string | number | null; to: string | number | null }> = {};
  const add = (key: string, fromValue: string | number | null, toValue: string | number | null) => {
    if (fromValue === toValue) return;
    changes[key] = { from: fromValue, to: toValue };
  };

  add('case_id', from.case_id, to.case_id);
  add('site_id', from.site_id, to.site_id);
  add('visit_type', from.visit_type, to.visit_type);
  add('priority', from.priority, to.priority);
  add('scheduled_date', formatUtcDateKey(from.scheduled_date), formatUtcDateKey(to.scheduled_date));
  add(
    'time_window_start',
    timeDateToString(from.time_window_start) ?? null,
    timeDateToString(to.time_window_start) ?? null,
  );
  add(
    'time_window_end',
    timeDateToString(from.time_window_end) ?? null,
    timeDateToString(to.time_window_end) ?? null,
  );
  add('pharmacist_id', from.pharmacist_id, to.pharmacist_id);
  add('vehicle_resource_id', from.vehicle_resource_id, to.vehicle_resource_id);
  add('schedule_status', from.schedule_status, to.schedule_status);
  add('route_order', from.route_order, to.route_order);
  add('recurrence_rule', from.recurrence_rule, to.recurrence_rule);

  return {
    ...changes,
  };
}

async function withSerializableVisitSchedulePatchTransaction<T>(
  orgId: string,
  requestContext: AuthContext,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  for (let attempt = 0; attempt < VISIT_SCHEDULE_PATCH_SERIALIZABLE_RETRY_LIMIT; attempt += 1) {
    try {
      return await withOrgContext(orgId, work, {
        requestContext,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (cause) {
      if (!isSerializableTransactionConflict(cause)) {
        throw cause;
      }
      if (attempt === VISIT_SCHEDULE_PATCH_SERIALIZABLE_RETRY_LIMIT - 1) {
        throw new VisitSchedulePatchRetryLimitError();
      }
    }
  }

  throw new VisitSchedulePatchRetryLimitError();
}

async function authenticatedGET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問予定の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('訪問予定IDが不正です');

  const schedule = await prisma.visitSchedule.findFirst({
    where: { id, org_id: ctx.orgId },
    include: buildScheduleDetailInclude(ctx.orgId),
  });

  if (!schedule) return notFound('訪問予定が見つかりません');
  if (!canAccessVisitScheduleAssignment(ctx, schedule)) {
    return forbiddenResponse('この訪問予定を閲覧する権限がありません');
  }

  const careCase = await prisma.careCase.findFirst({
    where: {
      id: schedule.case_id,
      org_id: ctx.orgId,
    },
    select: {
      patient_id: true,
    },
  });
  if (!careCase) return notFound('訪問予定に紐づくケースが見つかりません');

  const safeSchedule = attachVisitSchedulePatientSummary(schedule);

  return success({
    ...safeSchedule,
    patient_id: careCase.patient_id,
    cycle_id: schedule.cycle_id,
  });
}

export async function GET(req: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
}

async function authenticatedPATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問予定の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('訪問予定IDが不正です');
  if (!canManageVisitScheduleLifecycle(ctx)) {
    return forbiddenResponse('訪問予定を更新する権限がありません');
  }

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = updateVisitScheduleSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const existing = await prisma.visitSchedule.findFirst({
    where: { id, org_id: ctx.orgId },
    select: {
      id: true,
      case_id: true,
      visit_type: true,
      priority: true,
      schedule_status: true,
      route_order: true,
      recurrence_rule: true,
      confirmed_at: true,
      pharmacist_id: true,
      site_id: true,
      vehicle_resource_id: true,
      scheduled_date: true,
      time_window_start: true,
      time_window_end: true,
      version: true,
      case_: {
        select: {
          primary_pharmacist_id: true,
          backup_pharmacist_id: true,
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
  if (!existing) return notFound('訪問予定が見つかりません');
  if (!canAccessVisitScheduleAssignment(ctx, existing)) {
    return forbiddenResponse('この訪問予定を更新する権限がありません');
  }

  const {
    case_id,
    site_id,
    scheduled_date,
    time_window_start,
    time_window_end,
    notes: _notes,
    vehicle_resource_id,
    schedule_status: targetScheduleStatus,
    expected_schedule_status: expectedScheduleStatus,
    ...rest
  } = parsed.data;
  void _notes;

  const changesRouteOrder =
    rest.route_order !== undefined && rest.route_order !== existing.route_order;
  if (existing.confirmed_at && changesRouteOrder) {
    return validationError('電話確定済みの訪問予定は順路を変更できません');
  }

  const changesLockedFields =
    case_id !== undefined ||
    site_id !== undefined ||
    scheduled_date !== undefined ||
    time_window_start !== undefined ||
    time_window_end !== undefined ||
    rest.pharmacist_id !== undefined;
  if (existing.confirmed_at && changesLockedFields) {
    return validationError('電話確定済みの訪問予定は専用のリスケジュール操作で変更してください');
  }
  if (
    !canBypassVisitScheduleAssignmentAccess(ctx) &&
    ((case_id !== undefined && case_id !== existing.case_id) ||
      (rest.pharmacist_id !== undefined && rest.pharmacist_id !== existing.pharmacist_id))
  ) {
    return forbiddenResponse('訪問予定のケースまたは担当薬剤師を変更する権限がありません');
  }

  const existingScheduleStatus = existing.schedule_status as ScheduleStatus;
  if (expectedScheduleStatus && expectedScheduleStatus !== existingScheduleStatus) {
    return conflict('訪問予定が同時に更新されました。再読み込みしてください', {
      expected_schedule_status: expectedScheduleStatus,
      current_schedule_status: existingScheduleStatus,
    });
  }
  const effectiveScheduleStatus = targetScheduleStatus ?? existingScheduleStatus;
  const changesActiveOccupancyStatus =
    targetScheduleStatus !== undefined &&
    !isActiveVisitScheduleStatus(existingScheduleStatus) &&
    isActiveVisitScheduleStatus(effectiveScheduleStatus);
  const touchesReadyGatedSchedule =
    isReadyGatedScheduleStatus(existingScheduleStatus) ||
    isReadyGatedScheduleStatus(effectiveScheduleStatus);
  const requiresReadyTransitionGate = shouldRequireReadyTransitionGate(
    existingScheduleStatus,
    targetScheduleStatus,
  );
  if (
    targetScheduleStatus &&
    isTerminalScheduleStatus(existingScheduleStatus) &&
    isReadyGatedScheduleStatus(targetScheduleStatus) &&
    targetScheduleStatus !== existingScheduleStatus
  ) {
    return validationError('終了済みまたは中止済みの訪問予定は ready 系ステータスへ戻せません');
  }
  if (touchesReadyGatedSchedule && case_id !== undefined && case_id !== existing.case_id) {
    return validationError('ready 系ステータスへ進める更新ではケース変更を同時に行えません');
  }
  if (touchesReadyGatedSchedule && scheduled_date !== undefined) {
    return validationError('ready 系ステータスへ進める更新では訪問日変更を同時に行えません');
  }

  const targetTimeWindowStart =
    time_window_start !== undefined
      ? time_window_start || undefined
      : readPatchTimeString(existing.time_window_start);
  const targetTimeWindowEnd =
    time_window_end !== undefined
      ? time_window_end || undefined
      : readPatchTimeString(existing.time_window_end);
  const touchesTimeWindow = time_window_start !== undefined || time_window_end !== undefined;
  if (touchesTimeWindow) {
    if (targetTimeWindowStart && !targetTimeWindowEnd) {
      return validationError('終了時刻も入力してください', {
        time_window_end: ['終了時刻も入力してください'],
      });
    }
    if (!targetTimeWindowStart && targetTimeWindowEnd) {
      return validationError('開始時刻も入力してください', {
        time_window_start: ['開始時刻も入力してください'],
      });
    }
    if (
      targetTimeWindowStart &&
      targetTimeWindowEnd &&
      timeStringToMinutes(targetTimeWindowEnd) <= timeStringToMinutes(targetTimeWindowStart)
    ) {
      return validationError('終了時刻は開始時刻より後にしてください', {
        time_window_end: ['終了時刻は開始時刻より後にしてください'],
      });
    }
  }

  const projectedSchedule = {
    case_id: case_id ?? existing.case_id,
    site_id: site_id !== undefined ? site_id || null : existing.site_id,
    visit_type: rest.visit_type ?? existing.visit_type,
    priority: rest.priority ?? existing.priority,
    scheduled_date: scheduled_date ? new Date(scheduled_date) : existing.scheduled_date,
    time_window_start:
      time_window_start !== undefined
        ? time_window_start
          ? hhmmToTimeDate(time_window_start)
          : null
        : existing.time_window_start,
    time_window_end:
      time_window_end !== undefined
        ? time_window_end
          ? hhmmToTimeDate(time_window_end)
          : null
        : existing.time_window_end,
    pharmacist_id: rest.pharmacist_id ?? existing.pharmacist_id,
    vehicle_resource_id:
      vehicle_resource_id !== undefined
        ? vehicle_resource_id || null
        : existing.vehicle_resource_id,
    schedule_status: targetScheduleStatus ?? existing.schedule_status,
    route_order: rest.route_order !== undefined ? rest.route_order : existing.route_order,
    recurrence_rule: rest.recurrence_rule ?? existing.recurrence_rule,
  };
  const projectedScheduleIsActive = isActiveVisitScheduleStatus(projectedSchedule.schedule_status);
  const changesScheduleTimingOrAssignment =
    scheduled_date !== undefined ||
    time_window_start !== undefined ||
    time_window_end !== undefined ||
    rest.pharmacist_id !== undefined;
  const changesScheduleOccupancy =
    changesScheduleTimingOrAssignment ||
    vehicle_resource_id !== undefined ||
    changesActiveOccupancyStatus;
  const changesVehicleRouteShape =
    changesScheduleTimingOrAssignment ||
    case_id !== undefined ||
    site_id !== undefined ||
    rest.route_order !== undefined;
  const shouldRecheckTimeConflict =
    projectedScheduleIsActive &&
    changesScheduleOccupancy &&
    projectedSchedule.time_window_start != null &&
    projectedSchedule.time_window_end != null;
  const targetVehicleResourceId =
    vehicle_resource_id !== undefined ? vehicle_resource_id : existing.vehicle_resource_id;
  const targetVehicleScheduledDate = projectedSchedule.scheduled_date;
  const targetVehicleSiteId = projectedSchedule.site_id;
  const shouldRecheckVehicleCapacity =
    Boolean(targetVehicleResourceId) &&
    projectedScheduleIsActive &&
    (vehicle_resource_id !== undefined ||
      scheduled_date !== undefined ||
      site_id !== undefined ||
      changesVehicleRouteShape ||
      changesActiveOccupancyStatus);
  const projectedAuditChanges = schedulePatchAuditChanges(existing, projectedSchedule);
  const hasProjectedChanges = Object.keys(projectedAuditChanges).length > 0;
  if (isTerminalScheduleStatus(existingScheduleStatus) && hasProjectedChanges) {
    return validationError('終了済みまたは中止済みの訪問予定は変更できません');
  }
  if (!hasProjectedChanges) {
    const currentSchedule = await prisma.visitSchedule.findFirst({
      where: { id, org_id: ctx.orgId },
    });
    if (!currentSchedule) return notFound('訪問予定が見つかりません');
    return success(currentSchedule);
  }

  const refResult = await validateOrgReferences(ctx.orgId, {
    ...(case_id ? { case_id } : {}),
    ...(site_id ? { site_id } : {}),
    ...(rest.pharmacist_id ? { pharmacist_id: rest.pharmacist_id } : {}),
  });
  if (!refResult.ok) return refResult.response;

  if (changesScheduleTimingOrAssignment) {
    const targetDate = scheduled_date ? new Date(scheduled_date) : existing.scheduled_date;
    const targetPharmacistId = rest.pharmacist_id ?? existing.pharmacist_id;
    const shift = await prisma.pharmacistShift.findFirst({
      where: {
        org_id: ctx.orgId,
        user_id: targetPharmacistId,
        date: targetDate,
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
      targetTimeWindowStart,
      targetTimeWindowEnd,
    );
    if (shiftValidationError) {
      return validationError(shiftValidationError);
    }
  }

  let projectedRouteResidence = existing.case_.patient?.residences[0] ?? null;
  if (
    case_id !== undefined ||
    scheduled_date !== undefined ||
    time_window_start !== undefined ||
    time_window_end !== undefined
  ) {
    const targetCaseId = case_id ?? existing.case_id;
    const careCase = await prisma.careCase.findFirst({
      where: { id: targetCaseId, org_id: ctx.orgId },
      select: {
        patient: {
          select: {
            scheduling_preference: true,
            residences: {
              where: { is_primary: true },
              take: 1,
              select: {
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
    projectedRouteResidence = careCase.patient.residences[0] ?? null;

    const targetDate = scheduled_date ? new Date(scheduled_date) : existing.scheduled_date;
    const targetTimeWindowStart =
      time_window_start !== undefined
        ? time_window_start
        : readPatchTimeString(existing.time_window_start);
    const targetTimeWindowEnd =
      time_window_end !== undefined
        ? time_window_end
        : readPatchTimeString(existing.time_window_end);
    const preferenceValidationError = validateManualSchedulePreferences({
      scheduledDate: targetDate,
      timeWindowStart: targetTimeWindowStart,
      timeWindowEnd: targetTimeWindowEnd,
      schedulingPreference: careCase.patient.scheduling_preference,
      facility: careCase.patient.residences[0]?.facility ?? null,
    });
    if (preferenceValidationError) {
      return validationError(preferenceValidationError);
    }
  }

  if (shouldRecheckVehicleCapacity && targetVehicleResourceId) {
    const routeDurationContext = {
      candidatePoint: buildVehicleRoutePoint({
        scheduledDate: projectedSchedule.scheduled_date,
        routeOrder: projectedSchedule.route_order,
        timeWindowStart: projectedSchedule.time_window_start,
        residence: projectedRouteResidence,
      }),
    };
    const vehicleValidation = await validateVisitVehicleResourceForSchedule(prisma, {
      orgId: ctx.orgId,
      vehicleResourceId: targetVehicleResourceId,
      siteId: targetVehicleSiteId,
      scheduledDate: targetVehicleScheduledDate,
      excludeScheduleId: id,
      routeDurationContext,
    });
    if (!vehicleValidation.ok) return vehicleValidation.response;
  }

  const routeOrderTarget =
    rest.route_order !== undefined
      ? {
          date: scheduled_date ? new Date(scheduled_date) : existing.scheduled_date,
          pharmacistId: rest.pharmacist_id ?? existing.pharmacist_id,
          routeOrder: rest.route_order,
        }
      : null;
  if (routeOrderTarget) {
    if (!ROUTE_REORDERABLE_STATUSES.has(existing.schedule_status)) {
      return validationError('完了済みまたは中止済みの訪問予定は順路を変更できません');
    }
    const routeOrderConflict = await findVisitRouteOrderConflict(prisma, {
      orgId: ctx.orgId,
      cells: [
        {
          pharmacistId: routeOrderTarget.pharmacistId,
          dateKey: formatUtcDateKey(routeOrderTarget.date),
          routeOrder: routeOrderTarget.routeOrder,
        },
      ],
      excludeScheduleIds: [id],
    });
    if (routeOrderConflict) {
      return validationError('同一薬剤師・同一日付で route_order は重複できません');
    }
  }

  const runPatchTransaction =
    routeOrderTarget || shouldRecheckTimeConflict || shouldRecheckVehicleCapacity
      ? <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) =>
          withSerializableVisitSchedulePatchTransaction(ctx.orgId, ctx, work)
      : <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) =>
          withOrgContext(ctx.orgId, work, { requestContext: ctx });

  const patchScheduleResult = async (tx: Prisma.TransactionClient) => {
    if (requiresReadyTransitionGate) {
      const readyTransition = await evaluateVisitScheduleReadyTransition(tx, {
        orgId: ctx.orgId,
        scheduleId: id,
      });

      if (!readyTransition.ok) {
        return {
          ok: false as const,
          response: validationError(
            getVisitReadyTransitionErrorMessage(readyTransition.details),
            sanitizeVisitReadyTransitionDetails(readyTransition.details),
          ),
        };
      }
    }

    if (routeOrderTarget) {
      const routeOrderConflict = await findVisitRouteOrderConflict(tx, {
        orgId: ctx.orgId,
        cells: [
          {
            pharmacistId: routeOrderTarget.pharmacistId,
            dateKey: formatUtcDateKey(routeOrderTarget.date),
            routeOrder: routeOrderTarget.routeOrder,
          },
        ],
        excludeScheduleIds: [id],
      });
      if (routeOrderConflict) {
        return {
          ok: false as const,
          response: validationError('同一薬剤師・同一日付で route_order は重複できません'),
        };
      }
    }

    if (shouldRecheckTimeConflict) {
      const timeConflict = await findVisitScheduleTimeConflict(tx, {
        orgId: ctx.orgId,
        scheduledDate: projectedSchedule.scheduled_date,
        pharmacistId: projectedSchedule.pharmacist_id,
        timeWindowStart: projectedSchedule.time_window_start,
        timeWindowEnd: projectedSchedule.time_window_end,
        vehicleResourceId: projectedSchedule.vehicle_resource_id,
        excludeScheduleId: id,
      });
      if (timeConflict) {
        return {
          ok: false as const,
          response: conflict(getVisitScheduleTimeConflictMessage(timeConflict.kind)),
        };
      }
    }

    if (shouldRecheckVehicleCapacity && targetVehicleResourceId) {
      const routeDurationContext = {
        candidatePoint: buildVehicleRoutePoint({
          scheduledDate: projectedSchedule.scheduled_date,
          routeOrder: projectedSchedule.route_order,
          timeWindowStart: projectedSchedule.time_window_start,
          residence: projectedRouteResidence,
        }),
      };
      const vehicleValidation = await validateVisitVehicleResourceForSchedule(tx, {
        orgId: ctx.orgId,
        vehicleResourceId: targetVehicleResourceId,
        siteId: targetVehicleSiteId,
        scheduledDate: targetVehicleScheduledDate,
        excludeScheduleId: id,
        routeDurationContext,
      });
      if (!vehicleValidation.ok) {
        return {
          ok: false as const,
          response: vehicleValidation.response,
        };
      }
    }

    const updated = await tx.visitSchedule.updateMany({
      where: {
        id,
        org_id: ctx.orgId,
        version: existing.version,
        confirmed_at: existing.confirmed_at,
        pharmacist_id: existing.pharmacist_id,
        scheduled_date: existing.scheduled_date,
        schedule_status: existingScheduleStatus,
      },
      data: {
        ...(site_id !== undefined ? { site_id: site_id || null } : {}),
        ...(scheduled_date ? { scheduled_date: new Date(scheduled_date) } : {}),
        ...(time_window_start !== undefined
          ? {
              time_window_start: time_window_start ? hhmmToTimeDate(time_window_start) : null,
            }
          : {}),
        ...(time_window_end !== undefined
          ? {
              time_window_end: time_window_end ? hhmmToTimeDate(time_window_end) : null,
            }
          : {}),
        ...(targetScheduleStatus && isReadyGatedScheduleStatus(targetScheduleStatus)
          ? { pre_visit_checklist_completed: true }
          : {}),
        ...(case_id !== undefined ? { case_id } : {}),
        ...(vehicle_resource_id !== undefined
          ? { vehicle_resource_id: vehicle_resource_id || null }
          : {}),
        ...(targetScheduleStatus !== undefined ? { schedule_status: targetScheduleStatus } : {}),
        ...rest,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      return {
        ok: false as const,
        response: conflict('訪問予定が同時に更新されました。再読み込みしてください'),
      };
    }

    const updatedSchedule = await tx.visitSchedule.findFirst({
      where: { id, org_id: ctx.orgId },
    });
    if (!updatedSchedule) {
      return {
        ok: false as const,
        response: conflict('更新後の訪問予定を取得できません。再読み込みしてください'),
      };
    }
    const auditChanges = schedulePatchAuditChanges(existing, updatedSchedule);
    if (Object.keys(auditChanges).length > 0) {
      await createAuditLogEntry(tx, ctx, {
        action: 'visit_schedule_updated',
        targetType: 'VisitSchedule',
        targetId: updatedSchedule.id,
        changes: auditChanges,
      });
    }
    return { ok: true as const, schedule: updatedSchedule };
  };

  let schedule: Awaited<ReturnType<typeof patchScheduleResult>>;
  try {
    schedule = await runPatchTransaction(patchScheduleResult);
  } catch (cause) {
    if (cause instanceof VisitSchedulePatchRetryLimitError) {
      return conflict('route_order の反映対象が同時に更新されました。再読み込みしてください');
    }
    throw cause;
  }

  if (!schedule.ok) return schedule.response;

  await notifyWorkflowMutation({
    orgId: ctx.orgId,
    payload: { source: 'visit_schedules_update', schedule_id: id },
  });

  return success(schedule.schedule);
}

export async function PATCH(req: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  try {
    return withSensitiveNoStore(await authenticatedPATCH(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
}

function readPatchTimeString(value: Date | null | undefined) {
  return timeDateToString(value);
}

function timeStringToMinutes(value: string) {
  const [hours, minutes] = value.split(':').map((part) => Number.parseInt(part, 10));
  return hours * 60 + minutes;
}

const READY_GATED_SCHEDULE_STATUSES = new Set<ScheduleStatus>([
  'ready',
  'departed',
  'in_progress',
  'completed',
]);

const READY_SATISFIED_SCHEDULE_STATUSES = new Set<ScheduleStatus>([
  'ready',
  'departed',
  'in_progress',
  'completed',
]);

const TERMINAL_SCHEDULE_STATUSES = new Set<ScheduleStatus>([
  'completed',
  'cancelled',
  'postponed',
  'rescheduled',
  'no_show',
]);

function isReadyGatedScheduleStatus(status: ScheduleStatus) {
  return READY_GATED_SCHEDULE_STATUSES.has(status);
}

function isTerminalScheduleStatus(status: ScheduleStatus) {
  return TERMINAL_SCHEDULE_STATUSES.has(status);
}

function shouldRequireReadyTransitionGate(
  currentStatus: ScheduleStatus,
  targetStatus: ScheduleStatus | undefined,
) {
  return (
    targetStatus !== undefined &&
    isReadyGatedScheduleStatus(targetStatus) &&
    !READY_SATISFIED_SCHEDULE_STATUSES.has(currentStatus)
  );
}

/**
 * 取消理由(p0_37)。body は後方互換のため省略可。指定時は理由コードを検証し
 * AuditLog(visit_schedule_cancelled)に構造化記録する。
 */
const cancelScheduleSchema = z.object({
  reason_code: z.enum(VISIT_SCHEDULE_CANCEL_REASON_CODES).optional(),
  reason_note: z.string().trim().max(500, 'メモは500文字以内で入力してください').optional(),
});

async function authenticatedDELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問予定の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('訪問予定IDが不正です');
  if (!canManageVisitScheduleLifecycle(ctx)) {
    return forbiddenResponse('訪問予定を取消する権限がありません');
  }

  const payload = (await readOptionalJsonObjectRequestBody(req)) ?? {};
  const parsedReason = cancelScheduleSchema.safeParse(payload);
  if (!parsedReason.success) {
    return validationError('入力値が不正です', parsedReason.error.flatten().fieldErrors);
  }
  const reasonCode = parsedReason.data.reason_code ?? null;
  const reasonNote = parsedReason.data.reason_note || null;

  const existing = await prisma.visitSchedule.findFirst({
    where: { id, org_id: ctx.orgId },
    select: {
      id: true,
      pharmacist_id: true,
      version: true,
      schedule_status: true,
      case_: {
        select: {
          primary_pharmacist_id: true,
          backup_pharmacist_id: true,
        },
      },
    },
  });
  if (!existing) return notFound('訪問予定が見つかりません');
  if (!canAccessVisitScheduleAssignment(ctx, existing)) {
    return forbiddenResponse('この訪問予定を更新する権限がありません');
  }
  if (isTerminalScheduleStatus(existing.schedule_status)) {
    return validationError('終了済みまたは中止済みの訪問予定は取消できません');
  }

  const schedule = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const updated = await tx.visitSchedule.updateMany({
        where: {
          id,
          org_id: ctx.orgId,
          version: existing.version,
          schedule_status: existing.schedule_status,
        },
        data: { schedule_status: 'cancelled', version: { increment: 1 } },
      });
      if (updated.count !== 1) {
        return {
          ok: false as const,
          response: conflict('訪問予定が同時に更新されました。再読み込みしてください'),
        };
      }
      const updatedSchedule = await tx.visitSchedule.findFirst({
        where: { id, org_id: ctx.orgId },
      });
      if (!updatedSchedule) {
        return {
          ok: false as const,
          response: conflict('更新後の訪問予定を取得できません。再読み込みしてください'),
        };
      }
      const pendingOverrides = await tx.visitScheduleOverride.findMany({
        where: {
          org_id: ctx.orgId,
          source_schedule_id: id,
          status: 'pending',
        },
        select: { id: true },
      });
      const cancelledOverrideIds = pendingOverrides.map((override) => override.id);
      const cancelledOverrides =
        cancelledOverrideIds.length > 0
          ? await tx.visitScheduleOverride.updateMany({
              where: {
                org_id: ctx.orgId,
                source_schedule_id: id,
                status: 'pending',
                id: { in: cancelledOverrideIds },
              },
              data: {
                status: 'cancelled',
              },
            })
          : { count: 0 };
      const cancelledApprovalTasks = (await resolveOperationalTasks(tx, {
        orgId: ctx.orgId,
        dedupeKey: `visit-reschedule-approval:${id}`,
        status: 'cancelled',
      })) as { count?: number };
      const supersededRescheduleProposals = await tx.visitScheduleProposal.updateMany({
        where: {
          org_id: ctx.orgId,
          reschedule_source_schedule_id: id,
          proposal_status: {
            in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
          },
          finalized_schedule_id: null,
        },
        data: {
          proposal_status: 'superseded',
        },
      });
      await createAuditLogEntry(tx, ctx, {
        action: 'visit_schedule_cancelled',
        targetType: 'VisitSchedule',
        targetId: id,
        changes: {
          schedule_status: { from: existing.schedule_status, to: 'cancelled' },
          reason_code: reasonCode,
          reason_label: reasonCode ? visitScheduleCancelReasonLabel(reasonCode) : null,
          reason_note: reasonNote,
          cancelled_override_ids: cancelledOverrideIds,
          cancelled_override_count: cancelledOverrides.count,
          cancelled_reschedule_approval_task_count: cancelledApprovalTasks.count ?? null,
          superseded_reschedule_proposal_count: supersededRescheduleProposals.count,
        },
      });
      return { ok: true as const, schedule: updatedSchedule };
    },
    { requestContext: ctx },
  );

  if (!schedule.ok) return schedule.response;

  await notifyWorkflowMutation({
    orgId: ctx.orgId,
    payload: { source: 'visit_schedules_delete', schedule_id: id },
  });

  return success(schedule.schedule);
}

export async function DELETE(req: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  try {
    return withSensitiveNoStore(await authenticatedDELETE(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
}
