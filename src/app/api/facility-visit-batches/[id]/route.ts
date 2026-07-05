import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import type { ScheduleStatus } from '@prisma/client';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import {
  success,
  validationError,
  notFound,
  forbidden,
  conflict,
  internalError,
} from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { formatDateKey } from '@/lib/date-key';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import {
  buildVisitScheduleAssignmentWhere,
  canBypassVisitScheduleAssignmentAccess,
  canManageVisitScheduleLifecycle,
} from '@/lib/auth/visit-schedule-access';

const patchFacilityVisitBatchSchema = z.object({
  ordered_schedule_ids: z.array(z.string().trim().min(1)).min(1),
  expected_route_orders: z
    .array(
      z.object({
        schedule_id: z.string().trim().min(1),
        route_order: z.number().int().min(1).nullable(),
      }),
    )
    .max(100)
    .optional(),
});

const FACILITY_BATCH_ROUTE_REORDERABLE_STATUSES = [
  'planned',
  'in_preparation',
  'ready',
  'departed',
  'in_progress',
] satisfies readonly ScheduleStatus[];

const FACILITY_BATCH_ROUTE_REORDERABLE_STATUS_SET = new Set<ScheduleStatus>(
  FACILITY_BATCH_ROUTE_REORDERABLE_STATUSES,
);

type FacilityBatchDeleteRollbackResult = { error: 'stale_schedule' };

class FacilityBatchDeleteRollback extends Error {
  constructor(readonly result: FacilityBatchDeleteRollbackResult) {
    super('facility batch delete transaction rolled back');
    this.name = 'FacilityBatchDeleteRollback';
  }
}

function isFacilityBatchRouteStatusLocked(scheduleStatus: string | null | undefined) {
  return (
    scheduleStatus != null &&
    !FACILITY_BATCH_ROUTE_REORDERABLE_STATUS_SET.has(scheduleStatus as ScheduleStatus)
  );
}

function buildBatchScheduleAccessWhere(ctx: AuthContext, batchId: string) {
  const assignmentWhere = buildVisitScheduleAssignmentWhere(ctx);
  return {
    org_id: ctx.orgId,
    facility_batch_id: batchId,
    ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
  };
}

const authenticatedDELETE = withAuthContext(
  async (_req, ctx, { params }) => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('バッチIDが指定されていません');
    if (!canManageVisitScheduleLifecycle(ctx)) {
      return forbidden('施設一括訪問を更新する権限がありません');
    }

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const batch = await tx.facilityVisitBatch.findFirst({
        where: { id, org_id: ctx.orgId },
        select: {
          id: true,
          facility_id: true,
          facility_unit_id: true,
          scheduled_date: true,
          pharmacist_id: true,
        },
      });
      if (!batch) return { error: 'not_found' as const };

      if (!canBypassVisitScheduleAssignmentAccess(ctx)) {
        const [totalSchedules, accessibleSchedules] = await Promise.all([
          tx.visitSchedule.count({
            where: { org_id: ctx.orgId, facility_batch_id: id },
          }),
          tx.visitSchedule.count({
            where: buildBatchScheduleAccessWhere(ctx, id),
          }),
        ]);
        if (totalSchedules === 0 || totalSchedules !== accessibleSchedules) {
          return { error: 'forbidden' as const };
        }
      }

      const batchSchedules = await tx.visitSchedule.findMany({
        where: { org_id: ctx.orgId, facility_batch_id: id },
        select: {
          id: true,
          case_id: true,
          route_order: true,
          schedule_status: true,
          confirmed_at: true,
          version: true,
        },
      });
      if (
        batchSchedules.some((schedule) =>
          isFacilityBatchRouteStatusLocked(schedule.schedule_status),
        )
      ) {
        return { error: 'route_status_locked' as const };
      }
      if (batchSchedules.some((schedule) => schedule.confirmed_at != null)) {
        return { error: 'confirmed_route_change' as const };
      }

      const updateResults = await Promise.all(
        batchSchedules.map((schedule) =>
          tx.visitSchedule.updateMany({
            where: {
              id: schedule.id,
              org_id: ctx.orgId,
              facility_batch_id: id,
              version: schedule.version,
              schedule_status: { in: [...FACILITY_BATCH_ROUTE_REORDERABLE_STATUSES] },
              confirmed_at: null,
            },
            data: { facility_batch_id: null, route_order: null, version: { increment: 1 } },
          }),
        ),
      );
      if (updateResults.some((updateResult) => updateResult.count !== 1)) {
        throw new FacilityBatchDeleteRollback({ error: 'stale_schedule' });
      }

      await tx.facilityVisitBatch.delete({ where: { id } });

      await createAuditLogEntry(tx, ctx, {
        action: 'facility_visit_batch_deleted',
        targetType: 'FacilityVisitBatch',
        targetId: id,
        changes: {
          facility_unit_id: batch.facility_unit_id,
          scheduled_date: formatDateKey(batch.scheduled_date),
          pharmacist_id: batch.pharmacist_id,
          detached_schedules: batchSchedules.map((schedule) => ({
            schedule_id: schedule.id,
            case_id: schedule.case_id,
            previous_route_order: schedule.route_order ?? null,
          })),
        },
      });

      return { deleted: true };
    }).catch((err: unknown) => {
      if (err instanceof FacilityBatchDeleteRollback) {
        return err.result;
      }
      throw err;
    });

    if ('error' in result) {
      if (result.error === 'forbidden') {
        return forbidden('施設一括訪問バッチへのアクセス権限がありません');
      }
      if (result.error === 'route_status_locked') {
        return validationError('完了済みまたは中止済みの訪問予定は施設一括訪問から解除できません');
      }
      if (result.error === 'confirmed_route_change') {
        return validationError('電話確定済みの訪問予定は施設一括訪問から解除できません');
      }
      if (result.error === 'stale_schedule') {
        return conflict('施設一括訪問が同時に更新されました。再読み込みしてください');
      }
      return notFound('施設一括訪問バッチが見つかりません');
    }

    await notifyWorkflowMutation({
      orgId: ctx.orgId,
      payload: { source: 'facility_visit_batch_delete' },
    });

    return success({ deleted: true });
  },
  {
    permission: 'canVisit',
    message: '施設一括訪問の更新権限がありません',
  },
);

export const DELETE: typeof authenticatedDELETE = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedDELETE(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};

const authenticatedPATCH = withAuthContext(
  async (req, ctx, { params }) => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('バッチIDが指定されていません');
    if (!canManageVisitScheduleLifecycle(ctx)) {
      return forbidden('施設一括訪問を更新する権限がありません');
    }

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = patchFacilityVisitBatchSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const orderedIds = parsed.data.ordered_schedule_ids;
    if (new Set(orderedIds).size !== orderedIds.length) {
      return validationError('同じ訪問予定IDを複数回指定できません');
    }
    const expectedRouteOrders = parsed.data.expected_route_orders ?? null;
    if (
      expectedRouteOrders &&
      new Set(expectedRouteOrders.map((item) => item.schedule_id)).size !==
        expectedRouteOrders.length
    ) {
      return validationError('同じ訪問予定IDの現在順序を複数回指定できません');
    }
    if (expectedRouteOrders && expectedRouteOrders.length !== orderedIds.length) {
      return validationError('現在順序と対象予定数が一致しません');
    }
    if (
      expectedRouteOrders &&
      orderedIds.some(
        (scheduleId) => !expectedRouteOrders.some((item) => item.schedule_id === scheduleId),
      )
    ) {
      return validationError('現在順序に対象外の訪問予定が含まれています');
    }

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const batch = await tx.facilityVisitBatch.findFirst({
        where: { id, org_id: ctx.orgId },
        select: { id: true, pharmacist_id: true },
      });
      if (!batch) return { error: 'not_found' as const };

      const schedules = await tx.visitSchedule.findMany({
        where: { org_id: ctx.orgId, facility_batch_id: id },
        select: {
          id: true,
          case_id: true,
          route_order: true,
          schedule_status: true,
          confirmed_at: true,
          version: true,
        },
      });
      if (!canBypassVisitScheduleAssignmentAccess(ctx)) {
        const accessibleSchedules = await tx.visitSchedule.count({
          where: buildBatchScheduleAccessWhere(ctx, id),
        });
        if (schedules.length === 0 || schedules.length !== accessibleSchedules) {
          return { error: 'forbidden' as const };
        }
      }

      const batchScheduleIds = new Set(schedules.map((s) => s.id));
      const unknownId = orderedIds.find((scheduleId) => !batchScheduleIds.has(scheduleId));
      if (unknownId) {
        return { error: 'unknown_schedule' as const };
      }
      if (orderedIds.length !== batchScheduleIds.size) {
        return { error: 'incomplete_schedule_order' as const };
      }
      const expectedRouteOrderByScheduleId =
        expectedRouteOrders == null
          ? null
          : new Map(expectedRouteOrders.map((item) => [item.schedule_id, item.route_order]));
      if (
        expectedRouteOrderByScheduleId &&
        (expectedRouteOrderByScheduleId.size !== batchScheduleIds.size ||
          schedules.some((schedule) => !expectedRouteOrderByScheduleId.has(schedule.id)))
      ) {
        return { error: 'expected_route_order_target_mismatch' as const };
      }
      if (
        expectedRouteOrderByScheduleId &&
        schedules.some(
          (schedule) => expectedRouteOrderByScheduleId.get(schedule.id) !== schedule.route_order,
        )
      ) {
        return { error: 'stale_route_order' as const };
      }

      if (
        schedules.some((schedule) => isFacilityBatchRouteStatusLocked(schedule.schedule_status))
      ) {
        return { error: 'route_status_locked' as const };
      }

      const scheduleById = new Map(schedules.map((schedule) => [schedule.id, schedule]));
      const confirmedRouteChange = orderedIds.some((scheduleId, index) => {
        const schedule = scheduleById.get(scheduleId);
        return schedule?.confirmed_at != null && schedule.route_order !== index + 1;
      });
      if (confirmedRouteChange) {
        return { error: 'confirmed_route_change' as const };
      }

      const updateResults = await Promise.all(
        orderedIds.map((scheduleId, index) => {
          const schedule = scheduleById.get(scheduleId);
          if (!schedule) return Promise.resolve({ count: 0 });
          return tx.visitSchedule.updateMany({
            where: {
              org_id: ctx.orgId,
              id: scheduleId,
              facility_batch_id: id,
              version: schedule.version,
              ...(expectedRouteOrderByScheduleId?.has(scheduleId)
                ? { route_order: expectedRouteOrderByScheduleId.get(scheduleId) }
                : {}),
            },
            data: {
              route_order: index + 1,
              version: { increment: 1 },
            },
          });
        }),
      );
      if (updateResults.some((updateResult) => updateResult.count !== 1)) {
        return { error: 'stale_schedule' as const };
      }

      await createAuditLogEntry(tx, ctx, {
        action: 'facility_visit_batch_reordered',
        targetType: 'FacilityVisitBatch',
        targetId: id,
        changes: {
          schedules: orderedIds.map((scheduleId, index) => {
            const schedule = scheduleById.get(scheduleId);
            return {
              schedule_id: scheduleId,
              case_id: schedule?.case_id ?? null,
              previous_route_order: schedule?.route_order ?? null,
              ...(expectedRouteOrderByScheduleId?.has(scheduleId)
                ? { expected_route_order: expectedRouteOrderByScheduleId.get(scheduleId) }
                : {}),
              route_order: index + 1,
            };
          }),
        },
      });

      return { updated: true, order: orderedIds };
    });

    if ('error' in result) {
      if (result.error === 'not_found') {
        return notFound('施設一括訪問バッチが見つかりません');
      }
      if (result.error === 'forbidden') {
        return forbidden('施設一括訪問バッチへのアクセス権限がありません');
      }
      if (result.error === 'unknown_schedule') {
        return validationError('バッチに含まれない訪問予定IDが指定されています');
      }
      if (result.error === 'incomplete_schedule_order') {
        return validationError('バッチ内のすべての訪問予定IDを指定してください');
      }
      if (result.error === 'expected_route_order_target_mismatch') {
        return validationError('現在順序と対象予定数が一致しません');
      }
      if (result.error === 'stale_route_order') {
        return conflict('施設一括訪問の順序が同時に更新されました。再読み込みしてください');
      }
      if (result.error === 'route_status_locked') {
        return validationError('完了済みまたは中止済みの訪問予定は順路を変更できません');
      }
      if (result.error === 'confirmed_route_change') {
        return validationError('電話確定済みの訪問予定は順路を変更できません');
      }
      if (result.error === 'stale_schedule') {
        return conflict('施設一括訪問の順序が同時に更新されました。再読み込みしてください');
      }
    }

    await notifyWorkflowMutation({
      orgId: ctx.orgId,
      payload: { source: 'facility_visit_batch_reorder' },
    });

    return success(result);
  },
  {
    permission: 'canVisit',
    message: '施設一括訪問の更新権限がありません',
  },
);

export const PATCH: typeof authenticatedPATCH = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedPATCH(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};
