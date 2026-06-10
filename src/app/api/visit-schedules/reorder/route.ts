import { z } from 'zod';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { formatDateKey } from '@/lib/date-key';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, forbiddenResponse } from '@/lib/api/response';
import {
  buildVisitScheduleAssignmentWhere,
  canBypassVisitScheduleAssignmentAccess,
} from '@/lib/auth/visit-schedule-access';
import { visitScheduleDateKeySchema } from '@/lib/validations/visit-schedule';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import { validateScheduleTimeDatesFitShift } from '@/server/services/visit-schedule-shift';

const visitScheduleReorderSchema = z.object({
  updates: z
    .array(
      z.object({
        schedule_id: z.string().trim().min(1),
        route_order: z.number().int().min(1),
        scheduled_date: visitScheduleDateKeySchema('日付形式が不正です（YYYY-MM-DD）').optional(),
        pharmacist_id: z.string().trim().min(1).optional(),
      }),
    )
    .min(1),
});

export const PATCH = withAuth(
  async (req: AuthenticatedRequest) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = visitScheduleReorderSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const dedupedUpdates = Array.from(
      new Map(parsed.data.updates.map((item) => [item.schedule_id, item])).values(),
    );
    const uniqueScheduleIds = dedupedUpdates.map((item) => item.schedule_id);

    const result = await withOrgContext(req.orgId, async (tx) => {
      const assignmentWhere = buildVisitScheduleAssignmentWhere(req);
      const schedules = await tx.visitSchedule.findMany({
        where: {
          org_id: req.orgId,
          id: { in: uniqueScheduleIds },
          ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
        },
        select: {
          id: true,
          case_id: true,
          pharmacist_id: true,
          scheduled_date: true,
          time_window_start: true,
          time_window_end: true,
          confirmed_at: true,
        },
      });

      if (schedules.length !== uniqueScheduleIds.length) {
        return { error: 'not_found' as const };
      }

      const scheduleById = new Map(schedules.map((schedule) => [schedule.id, schedule]));
      if (!canBypassVisitScheduleAssignmentAccess(req)) {
        const pharmacistChange = dedupedUpdates.find((item) => {
          const schedule = scheduleById.get(item.schedule_id);
          return (
            item.pharmacist_id !== undefined &&
            schedule !== undefined &&
            item.pharmacist_id !== schedule.pharmacist_id
          );
        });
        if (pharmacistChange) {
          return { error: 'pharmacist_change_forbidden' as const };
        }
      }

      const pharmacistIds = Array.from(
        new Set(
          dedupedUpdates
            .map((item) => item.pharmacist_id)
            .filter((value): value is string => Boolean(value)),
        ),
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

      const routeCellByKey = dedupedUpdates.reduce((map, item) => {
        const schedule = scheduleById.get(item.schedule_id);
        if (!schedule) return map;
        const targetDate = item.scheduled_date ?? formatDateKey(schedule.scheduled_date);
        const targetPharmacistId = item.pharmacist_id ?? schedule.pharmacist_id;
        const key = `${targetPharmacistId}:${targetDate}:${item.route_order}`;
        const current = map.get(key);
        map.set(key, {
          pharmacistId: targetPharmacistId,
          scheduledDate: targetDate,
          routeOrder: item.route_order,
          count: (current?.count ?? 0) + 1,
        });
        return map;
      }, new Map<string, { pharmacistId: string; scheduledDate: string; routeOrder: number; count: number }>());

      const routeCells = Array.from(routeCellByKey.values());
      if (routeCells.some((cell) => cell.count > 1)) {
        return { error: 'duplicate_route_order' as const };
      }

      const existingRouteOrderConflict = await tx.visitSchedule.findFirst({
        where: {
          org_id: req.orgId,
          id: { notIn: uniqueScheduleIds },
          OR: routeCells.map((cell) => ({
            pharmacist_id: cell.pharmacistId,
            scheduled_date: new Date(cell.scheduledDate),
            route_order: cell.routeOrder,
          })),
        },
        select: { id: true },
      });
      if (existingRouteOrderConflict) {
        return { error: 'duplicate_route_order' as const };
      }

      const confirmedDateMoves = dedupedUpdates.find((item) => {
        const schedule = scheduleById.get(item.schedule_id);
        if (!schedule?.confirmed_at) return false;
        const nextDate = item.scheduled_date ?? formatDateKey(schedule.scheduled_date);
        const nextPharmacistId = item.pharmacist_id ?? schedule.pharmacist_id;
        return (
          nextDate !== formatDateKey(schedule.scheduled_date) ||
          nextPharmacistId !== schedule.pharmacist_id
        );
      });
      if (confirmedDateMoves) {
        return { error: 'confirmed_move' as const };
      }

      const moveTargets = dedupedUpdates
        .map((item) => {
          const schedule = scheduleById.get(item.schedule_id);
          if (!schedule) return null;
          const targetDate = item.scheduled_date ?? formatDateKey(schedule.scheduled_date);
          const targetPharmacistId = item.pharmacist_id ?? schedule.pharmacist_id;
          const isMove =
            targetDate !== formatDateKey(schedule.scheduled_date) ||
            targetPharmacistId !== schedule.pharmacist_id;
          return isMove ? { schedule, targetDate, targetPharmacistId } : null;
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item));
      const targetShiftKeys = Array.from(
        new Set(moveTargets.map((item) => `${item.targetPharmacistId}:${item.targetDate}`)),
      );
      const targetShifts =
        targetShiftKeys.length === 0
          ? []
          : await tx.pharmacistShift.findMany({
              where: {
                org_id: req.orgId,
                OR: targetShiftKeys.map((key) => {
                  const [userId, date] = key.split(':');
                  return {
                    user_id: userId,
                    date: new Date(date),
                  };
                }),
              },
              select: {
                site_id: true,
                user_id: true,
                date: true,
                available: true,
                available_from: true,
                available_to: true,
              },
            });
      const shiftByTarget = new Map(
        targetShifts.map((shift) => [`${shift.user_id}:${formatDateKey(shift.date)}`, shift]),
      );
      const shiftConflict = moveTargets.find((item) => {
        const shift = shiftByTarget.get(`${item.targetPharmacistId}:${item.targetDate}`) ?? null;
        return validateScheduleTimeDatesFitShift(
          shift,
          item.schedule.time_window_start,
          item.schedule.time_window_end,
        );
      });
      if (shiftConflict) {
        const shift =
          shiftByTarget.get(`${shiftConflict.targetPharmacistId}:${shiftConflict.targetDate}`) ??
          null;
        return {
          error: 'shift_conflict' as const,
          message:
            validateScheduleTimeDatesFitShift(
              shift,
              shiftConflict.schedule.time_window_start,
              shiftConflict.schedule.time_window_end,
            ) ?? '移動先シフトと訪問予定の時間帯が一致しません',
        };
      }

      await Promise.all(
        dedupedUpdates.map((item) => {
          const schedule = scheduleById.get(item.schedule_id);
          const targetDate =
            item.scheduled_date ?? (schedule ? formatDateKey(schedule.scheduled_date) : undefined);
          const targetPharmacistId = item.pharmacist_id ?? schedule?.pharmacist_id;
          const targetShift =
            targetDate && targetPharmacistId
              ? (shiftByTarget.get(`${targetPharmacistId}:${targetDate}`) ?? null)
              : null;

          return tx.visitSchedule.update({
            where: { id: item.schedule_id },
            data: {
              route_order: item.route_order,
              ...(item.scheduled_date ? { scheduled_date: new Date(item.scheduled_date) } : {}),
              ...(item.pharmacist_id ? { pharmacist_id: item.pharmacist_id } : {}),
              ...(targetShift ? { site_id: targetShift.site_id } : {}),
              version: { increment: 1 },
            },
          });
        }),
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
      if (result.error === 'pharmacist_change_forbidden') {
        return forbiddenResponse('訪問予定のケースまたは担当薬剤師を変更する権限がありません');
      }
      if (result.error === 'invalid_pharmacist') {
        return validationError('指定された薬剤師はこの組織に所属していません');
      }
      if (result.error === 'confirmed_move') {
        return validationError('電話確定済みの訪問予定は日付や担当を変更できません');
      }
      if (result.error === 'shift_conflict') {
        return validationError(result.message);
      }
      if (result.error === 'duplicate_route_order') {
        return validationError('同一セル内で route_order は重複できません');
      }
    }

    await Promise.all(
      result.case_ids.map((caseId) =>
        notifyWorkflowMutation({
          orgId: req.orgId,
          payload: { source: 'visit_schedules_reorder', case_id: caseId },
        }),
      ),
    );

    return success(result);
  },
  {
    permission: 'canVisit',
    message: '訪問予定の更新権限がありません',
  },
);
