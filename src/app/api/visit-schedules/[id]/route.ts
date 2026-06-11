import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import {
  canAccessVisitScheduleAssignment,
  canBypassVisitScheduleAssignmentAccess,
} from '@/lib/auth/visit-schedule-access';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { timeDateToString } from '@/lib/visits/time-of-day';
import { withOrgContext } from '@/lib/db/rls';
import { SCHEDULE_DETAIL_INCLUDE } from '@/lib/db/schedule-includes';
import {
  success,
  validationError,
  notFound,
  forbiddenResponse,
  conflict,
} from '@/lib/api/response';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { updateVisitScheduleSchema, type ScheduleStatus } from '@/lib/validations/visit-schedule';
import { prisma } from '@/lib/db/client';
import { validateScheduleTimeStringsFitShift } from '@/server/services/visit-schedule-shift';
import {
  validateManualSchedulePreferences,
  validateVisitVehicleResourceForSchedule,
} from '@/server/services/visit-schedule-service';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import {
  evaluateVisitScheduleReadyTransition,
  getVisitReadyTransitionErrorMessage,
  type VisitReadyTransitionBlockers,
} from '@/server/services/visit-preparation-readiness';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    include: SCHEDULE_DETAIL_INCLUDE,
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

  return success({
    ...schedule,
    patient_id: careCase.patient_id,
    cycle_id: schedule.cycle_id,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問予定の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('訪問予定IDが不正です');

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
      schedule_status: true,
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
    ...rest
  } = parsed.data;
  void _notes;

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

  const targetScheduleStatus = rest.schedule_status;
  const existingScheduleStatus = existing.schedule_status as ScheduleStatus;
  const effectiveScheduleStatus = targetScheduleStatus ?? existingScheduleStatus;
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

  const refResult = await validateOrgReferences(ctx.orgId, {
    ...(case_id ? { case_id } : {}),
    ...(site_id ? { site_id } : {}),
    ...(rest.pharmacist_id ? { pharmacist_id: rest.pharmacist_id } : {}),
  });
  if (!refResult.ok) return refResult.response;

  const changesScheduleTimingOrAssignment =
    scheduled_date !== undefined ||
    time_window_start !== undefined ||
    time_window_end !== undefined ||
    rest.pharmacist_id !== undefined;
  if (changesScheduleTimingOrAssignment) {
    const targetDate = scheduled_date ? new Date(scheduled_date) : existing.scheduled_date;
    const targetPharmacistId = rest.pharmacist_id ?? existing.pharmacist_id;
    const targetTimeWindowStart =
      time_window_start !== undefined
        ? time_window_start || undefined
        : readPatchTimeString(existing.time_window_start);
    const targetTimeWindowEnd =
      time_window_end !== undefined
        ? time_window_end || undefined
        : readPatchTimeString(existing.time_window_end);

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

  const targetVehicleResourceId =
    vehicle_resource_id !== undefined ? vehicle_resource_id : existing.vehicle_resource_id;
  if (targetVehicleResourceId) {
    const targetDate = scheduled_date ? new Date(scheduled_date) : existing.scheduled_date;
    const targetPharmacistId = rest.pharmacist_id ?? existing.pharmacist_id;
    const targetSiteId = site_id !== undefined ? site_id || null : existing.site_id;
    const vehicleValidation = await validateVisitVehicleResourceForSchedule(prisma, {
      orgId: ctx.orgId,
      vehicleResourceId: targetVehicleResourceId,
      siteId: targetSiteId,
      pharmacistId: targetPharmacistId,
      scheduledDate: targetDate,
      excludeScheduleId: id,
    });
    if (!vehicleValidation.ok) return vehicleValidation.response;
  }

  const routeOrderTarget =
    rest.route_order !== undefined
      ? {
          date: scheduled_date ? new Date(scheduled_date) : existing.scheduled_date,
          pharmacistId: rest.pharmacist_id ?? existing.pharmacist_id,
        }
      : null;
  if (routeOrderTarget) {
    const routeOrderConflict = await prisma.visitSchedule.findFirst({
      where: {
        org_id: ctx.orgId,
        id: { not: id },
        pharmacist_id: routeOrderTarget.pharmacistId,
        scheduled_date: routeOrderTarget.date,
        route_order: rest.route_order,
      },
      select: { id: true },
    });
    if (routeOrderConflict) {
      return validationError('同一薬剤師・同一日付で route_order は重複できません');
    }
  }

  const schedule = await withOrgContext(
    ctx.orgId,
    async (tx) => {
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
        const routeOrderConflict = await tx.visitSchedule.findFirst({
          where: {
            org_id: ctx.orgId,
            id: { not: id },
            pharmacist_id: routeOrderTarget.pharmacistId,
            scheduled_date: routeOrderTarget.date,
            route_order: rest.route_order,
          },
          select: { id: true },
        });
        if (routeOrderConflict) {
          return {
            ok: false as const,
            response: validationError('同一薬剤師・同一日付で route_order は重複できません'),
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
                time_window_start: time_window_start
                  ? new Date(`1970-01-01T${time_window_start}`)
                  : null,
              }
            : {}),
          ...(time_window_end !== undefined
            ? {
                time_window_end: time_window_end ? new Date(`1970-01-01T${time_window_end}`) : null,
              }
            : {}),
          ...(targetScheduleStatus && isReadyGatedScheduleStatus(targetScheduleStatus)
            ? { pre_visit_checklist_completed: true }
            : {}),
          ...(case_id !== undefined ? { case_id } : {}),
          ...(vehicle_resource_id !== undefined
            ? { vehicle_resource_id: vehicle_resource_id || null }
            : {}),
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
      return { ok: true as const, schedule: updatedSchedule };
    },
    { requestContext: ctx },
  );

  if (!schedule.ok) return schedule.response;

  await notifyWorkflowMutation({
    orgId: ctx.orgId,
    payload: { source: 'visit_schedules_update', schedule_id: id },
  });

  return success(schedule.schedule);
}

function readPatchTimeString(value: Date | null | undefined) {
  return timeDateToString(value);
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

function sanitizeVisitReadyTransitionDetails(details: VisitReadyTransitionBlockers) {
  return {
    readiness_blockers: details.readiness_blockers,
    onboarding_blockers: details.onboarding_blockers,
    billing_blockers: details.billing_blockers.map(({ key, reason, action_label, severity }) => ({
      key,
      reason,
      action_label,
      severity,
    })),
  };
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問予定の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('訪問予定IDが不正です');

  const existing = await prisma.visitSchedule.findFirst({
    where: { id, org_id: ctx.orgId },
    select: {
      id: true,
      pharmacist_id: true,
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

  const schedule = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      return tx.visitSchedule.update({
        where: { id },
        data: { schedule_status: 'cancelled' },
      });
    },
    { requestContext: ctx },
  );

  await notifyWorkflowMutation({
    orgId: ctx.orgId,
    payload: { source: 'visit_schedules_delete', schedule_id: id },
  });

  return success(schedule);
}
