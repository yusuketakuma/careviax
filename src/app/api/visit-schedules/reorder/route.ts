import { z } from 'zod';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';

const visitScheduleReorderSchema = z.object({
  updates: z
    .array(
      z.object({
        schedule_id: z.string().trim().min(1),
        route_order: z.number().int().min(1),
        scheduled_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）')
          .optional(),
        pharmacist_id: z.string().trim().min(1).optional(),
      })
    )
    .min(1),
});

export const PATCH = withAuth(
  async (req: AuthenticatedRequest) => {
    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = visitScheduleReorderSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const dedupedUpdates = Array.from(
      new Map(parsed.data.updates.map((item) => [item.schedule_id, item])).values()
    );
    const uniqueScheduleIds = dedupedUpdates.map((item) => item.schedule_id);
    const duplicateRouteOrders = dedupedUpdates
      .reduce((map, item) => {
        const key = `${item.pharmacist_id ?? ''}:${item.scheduled_date ?? ''}:${item.route_order}`;
        map.set(key, (map.get(key) ?? 0) + 1);
        return map;
      }, new Map<string, number>());

    if (Array.from(duplicateRouteOrders.values()).some((count) => count > 1)) {
      return validationError('同一セル内で route_order は重複できません');
    }

    const result = await withOrgContext(req.orgId, async (tx) => {
      const schedules = await tx.visitSchedule.findMany({
        where: {
          org_id: req.orgId,
          id: { in: uniqueScheduleIds },
        },
        select: {
          id: true,
          case_id: true,
          pharmacist_id: true,
          scheduled_date: true,
          confirmed_at: true,
        },
      });

      if (schedules.length !== uniqueScheduleIds.length) {
        return { error: 'not_found' as const };
      }

      const pharmacistIds = Array.from(
        new Set(
          dedupedUpdates
            .map((item) => item.pharmacist_id)
            .filter((value): value is string => Boolean(value))
        )
      );

      if (pharmacistIds.length > 0) {
        const memberships = await tx.membership.findMany({
          where: {
            org_id: req.orgId,
            user_id: { in: pharmacistIds },
            is_active: true,
            role: {
              in: ['owner', 'admin', 'pharmacist', 'pharmacist_trainee'],
            },
          },
          select: { user_id: true },
        });
        if (memberships.length !== pharmacistIds.length) {
          return { error: 'invalid_pharmacist' as const };
        }
      }

      const scheduleById = new Map(schedules.map((schedule) => [schedule.id, schedule]));
      const confirmedDateMoves = dedupedUpdates.find((item) => {
        const schedule = scheduleById.get(item.schedule_id);
        if (!schedule?.confirmed_at) return false;
        const nextDate = item.scheduled_date ?? schedule.scheduled_date.toISOString().slice(0, 10);
        const nextPharmacistId = item.pharmacist_id ?? schedule.pharmacist_id;
        return (
          nextDate !== schedule.scheduled_date.toISOString().slice(0, 10) ||
          nextPharmacistId !== schedule.pharmacist_id
        );
      });
      if (confirmedDateMoves) {
        return { error: 'confirmed_move' as const };
      }

      await Promise.all(
        dedupedUpdates.map((item) =>
          tx.visitSchedule.update({
            where: { id: item.schedule_id },
            data: {
              route_order: item.route_order,
              ...(item.scheduled_date ? { scheduled_date: new Date(item.scheduled_date) } : {}),
              ...(item.pharmacist_id ? { pharmacist_id: item.pharmacist_id } : {}),
              version: { increment: 1 },
            },
          })
        )
      );

      await tx.auditLog.create({
        data: {
          org_id: req.orgId,
          actor_id: req.userId,
          action: 'visit_schedules_reordered',
          target_type: 'VisitScheduleBatch',
          target_id: uniqueScheduleIds[0],
          changes: {
            updates: dedupedUpdates.map((item) => ({
              schedule_id: item.schedule_id,
              route_order: item.route_order,
              scheduled_date: item.scheduled_date ?? null,
              pharmacist_id: item.pharmacist_id ?? null,
            })),
          },
        },
      });

      return {
        case_ids: Array.from(new Set(schedules.map((schedule) => schedule.case_id))),
        schedule_ids: uniqueScheduleIds,
      };
    });

    if ('error' in result) {
      if (result.error === 'not_found') {
        return notFound('対象の訪問予定が見つかりません');
      }
      if (result.error === 'invalid_pharmacist') {
        return validationError('指定された薬剤師はこの組織に所属していません');
      }
      if (result.error === 'confirmed_move') {
        return validationError('電話確定済みの訪問予定は日付や担当を変更できません');
      }
    }

    await Promise.all(
      result.case_ids.map((caseId) =>
        notifyWorkflowMutation({
          orgId: req.orgId,
          payload: { source: 'visit_schedules_reorder', case_id: caseId },
        })
      )
    );

    return success(result);
  },
  {
    permission: 'canVisit',
    message: '訪問予定の更新権限がありません',
  }
);
