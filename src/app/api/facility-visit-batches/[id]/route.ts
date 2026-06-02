import { z } from 'zod';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { success, validationError, notFound, forbidden } from '@/lib/api/response';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import {
  buildVisitScheduleAssignmentWhere,
  canBypassVisitScheduleAssignmentAccess,
} from '@/lib/auth/visit-schedule-access';

const patchFacilityVisitBatchSchema = z.object({
  ordered_schedule_ids: z.array(z.string().trim().min(1)).min(1),
});

function buildBatchScheduleAccessWhere(req: AuthenticatedRequest, batchId: string) {
  const assignmentWhere = buildVisitScheduleAssignmentWhere(req);
  return {
    org_id: req.orgId,
    facility_batch_id: batchId,
    ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
  };
}

export const DELETE = withAuth(
  async (req: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('バッチIDが指定されていません');

    const result = await withOrgContext(req.orgId, async (tx) => {
      const batch = await tx.facilityVisitBatch.findFirst({
        where: { id, org_id: req.orgId },
        select: { id: true, pharmacist_id: true },
      });
      if (!batch) return { error: 'not_found' as const };

      if (!canBypassVisitScheduleAssignmentAccess(req)) {
        const [totalSchedules, accessibleSchedules] = await Promise.all([
          tx.visitSchedule.count({
            where: { org_id: req.orgId, facility_batch_id: id },
          }),
          tx.visitSchedule.count({
            where: buildBatchScheduleAccessWhere(req, id),
          }),
        ]);
        if (totalSchedules === 0 || totalSchedules !== accessibleSchedules) {
          return { error: 'forbidden' as const };
        }
      }

      await tx.visitSchedule.updateMany({
        where: { org_id: req.orgId, facility_batch_id: id },
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
      orgId: req.orgId,
      payload: { source: 'facility_visit_batch_delete' },
    });

    return success({ deleted: true });
  },
  {
    permission: 'canVisit',
    message: '施設一括訪問の更新権限がありません',
  },
);

export const PATCH = withAuth(
  async (req: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('バッチIDが指定されていません');

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = patchFacilityVisitBatchSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const orderedIds = Array.from(new Set(parsed.data.ordered_schedule_ids));

    const result = await withOrgContext(req.orgId, async (tx) => {
      const batch = await tx.facilityVisitBatch.findFirst({
        where: { id, org_id: req.orgId },
        select: { id: true, pharmacist_id: true },
      });
      if (!batch) return { error: 'not_found' as const };

      const schedules = await tx.visitSchedule.findMany({
        where: { org_id: req.orgId, facility_batch_id: id },
        select: { id: true },
      });
      if (!canBypassVisitScheduleAssignmentAccess(req)) {
        const accessibleSchedules = await tx.visitSchedule.count({
          where: buildBatchScheduleAccessWhere(req, id),
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

      await Promise.all(
        orderedIds.map((scheduleId, index) =>
          tx.visitSchedule.update({
            where: { id: scheduleId },
            data: { route_order: index + 1 },
          }),
        ),
      );

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
    }

    await notifyWorkflowMutation({
      orgId: req.orgId,
      payload: { source: 'facility_visit_batch_reorder' },
    });

    return success(result);
  },
  {
    permission: 'canVisit',
    message: '施設一括訪問の更新権限がありません',
  },
);
