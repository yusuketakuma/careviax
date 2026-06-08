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
import { success, validationError, notFound, forbiddenResponse } from '@/lib/api/response';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { updateVisitScheduleSchema } from '@/lib/validations/visit-schedule';
import { prisma } from '@/lib/db/client';
import { validateScheduleTimeStringsFitShift } from '@/server/services/visit-schedule-shift';
import {
  validateManualSchedulePreferences,
  validateVisitVehicleResourceForSchedule,
} from '@/server/services/visit-schedule-service';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';

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
      confirmed_at: true,
      pharmacist_id: true,
      site_id: true,
      vehicle_resource_id: true,
      scheduled_date: true,
      time_window_start: true,
      time_window_end: true,
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

  if (rest.schedule_status === 'ready') {
    const preparation = await prisma.visitPreparation.findFirst({
      where: {
        org_id: ctx.orgId,
        schedule_id: id,
      },
      select: {
        medication_changes_reviewed: true,
        carry_items_confirmed: true,
        previous_issues_reviewed: true,
        route_confirmed: true,
        offline_synced: true,
      },
    });

    const readyForVisit =
      preparation?.medication_changes_reviewed &&
      preparation.carry_items_confirmed &&
      preparation.previous_issues_reviewed &&
      preparation.route_confirmed &&
      preparation.offline_synced;

    if (!readyForVisit) {
      return validationError('訪問準備チェックリストが未完了のため ready へ進めません');
    }
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

  if (rest.route_order !== undefined) {
    const targetDate = scheduled_date ? new Date(scheduled_date) : existing.scheduled_date;
    const targetPharmacistId = rest.pharmacist_id ?? existing.pharmacist_id;
    const routeOrderConflict = await prisma.visitSchedule.findFirst({
      where: {
        org_id: ctx.orgId,
        id: { not: id },
        pharmacist_id: targetPharmacistId,
        scheduled_date: targetDate,
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
      return tx.visitSchedule.update({
        where: { id },
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
          ...(rest.schedule_status === 'ready' ? { pre_visit_checklist_completed: true } : {}),
          ...(case_id !== undefined ? { case_id } : {}),
          ...(vehicle_resource_id !== undefined
            ? { vehicle_resource_id: vehicle_resource_id || null }
            : {}),
          ...rest,
          version: { increment: 1 },
        },
      });
    },
    { requestContext: ctx },
  );

  await notifyWorkflowMutation({
    orgId: ctx.orgId,
    payload: { source: 'visit_schedules_update', schedule_id: id },
  });

  return success(schedule);
}

function readPatchTimeString(value: Date | null | undefined) {
  return timeDateToString(value);
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
