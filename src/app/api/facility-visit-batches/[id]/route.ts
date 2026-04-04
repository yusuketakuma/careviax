import { z } from 'zod';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';

const patchFacilityVisitBatchSchema = z.object({
  ordered_schedule_ids: z.array(z.string().trim().min(1)).min(1),
});

export const DELETE = withAuth(
  async (req: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    if (!id) return validationError('バッチIDが指定されていません');

    const result = await withOrgContext(req.orgId, async (tx) => {
      const batch = await tx.facilityVisitBatch.findFirst({
        where: { id, org_id: req.orgId },
        select: { id: true },
      });
      if (!batch) return { error: 'not_found' as const };

      await tx.visitSchedule.updateMany({
        where: { org_id: req.orgId, facility_batch_id: id },
        data: { facility_batch_id: null, route_order: null },
      });

      await tx.facilityVisitBatch.delete({ where: { id } });

      return { deleted: true };
    });

    if ('error' in result) {
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
  }
);

export const PATCH = withAuth(
  async (req: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    if (!id) return validationError('バッチIDが指定されていません');

    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = patchFacilityVisitBatchSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const orderedIds = Array.from(new Set(parsed.data.ordered_schedule_ids));

    const result = await withOrgContext(req.orgId, async (tx) => {
      const batch = await tx.facilityVisitBatch.findFirst({
        where: { id, org_id: req.orgId },
        select: { id: true },
      });
      if (!batch) return { error: 'not_found' as const };

      const schedules = await tx.visitSchedule.findMany({
        where: { org_id: req.orgId, facility_batch_id: id },
        select: { id: true },
      });

      const batchScheduleIds = new Set(schedules.map((s) => s.id));
      const unknownId = orderedIds.find((scheduleId) => !batchScheduleIds.has(scheduleId));
      if (unknownId) {
        return { error: 'unknown_schedule' as const };
      }

      await Promise.all(
        orderedIds.map((scheduleId, index) =>
          tx.visitSchedule.update({
            where: { id: scheduleId },
            data: { route_order: index + 1 },
          })
        )
      );

      return { updated: true, order: orderedIds };
    });

    if ('error' in result) {
      if (result.error === 'not_found') {
        return notFound('施設一括訪問バッチが見つかりません');
      }
      if (result.error === 'unknown_schedule') {
        return validationError('バッチに含まれない訪問予定IDが指定されています');
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
  }
);
