import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
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
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import {
  buildVisitScheduleAssignmentWhere,
  canBypassVisitScheduleAssignmentAccess,
} from '@/lib/auth/visit-schedule-access';

const patchFacilityVisitBatchSchema = z.object({
  ordered_schedule_ids: z.array(z.string().trim().min(1)).min(1),
});

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

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const batch = await tx.facilityVisitBatch.findFirst({
        where: { id, org_id: ctx.orgId },
        select: { id: true, pharmacist_id: true },
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

      await tx.visitSchedule.updateMany({
        where: { org_id: ctx.orgId, facility_batch_id: id },
        data: { facility_batch_id: null, route_order: null },
      });

      await tx.facilityVisitBatch.delete({ where: { id } });

      return { deleted: true };
    });

    if ('error' in result) {
      if (result.error === 'forbidden') {
        return forbidden('施設一括訪問バッチへのアクセス権限がありません');
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

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const batch = await tx.facilityVisitBatch.findFirst({
        where: { id, org_id: ctx.orgId },
        select: { id: true, pharmacist_id: true },
      });
      if (!batch) return { error: 'not_found' as const };

      const schedules = await tx.visitSchedule.findMany({
        where: { org_id: ctx.orgId, facility_batch_id: id },
        select: { id: true },
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

      const updateResults = await Promise.all(
        orderedIds.map((scheduleId, index) =>
          tx.visitSchedule.updateMany({
            where: {
              org_id: ctx.orgId,
              id: scheduleId,
              facility_batch_id: id,
            },
            data: {
              route_order: index + 1,
              version: { increment: 1 },
            },
          }),
        ),
      );
      if (updateResults.some((updateResult) => updateResult.count !== 1)) {
        return { error: 'stale_schedule' as const };
      }

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
