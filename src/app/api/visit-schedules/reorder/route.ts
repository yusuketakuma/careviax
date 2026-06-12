import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { formatDateKey } from '@/lib/date-key';
import { withOrgContext } from '@/lib/db/rls';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import {
  success,
  validationError,
  notFound,
  forbiddenResponse,
  conflict,
} from '@/lib/api/response';
import {
  buildVisitScheduleAssignmentWhere,
  canBypassVisitScheduleAssignmentAccess,
} from '@/lib/auth/visit-schedule-access';
import { OPEN_VISIT_SCHEDULE_PROPOSAL_STATUSES as OPEN_PROPOSAL_STATUSES } from '@/lib/visit-schedule-proposals/route-order';
import { visitScheduleDateKeySchema } from '@/lib/validations/visit-schedule';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import { validateScheduleTimeDatesFitShift } from '@/server/services/visit-schedule-shift';

const VISIT_SCHEDULE_REORDER_SERIALIZABLE_RETRY_LIMIT = 3;

const routeOrderConfirmationContextSchema = z.object({
  source: z.enum(['schedule_day_route_preview']),
  date: visitScheduleDateKeySchema('確認日付の形式が不正です（YYYY-MM-DD）').optional(),
  pharmacist_id: z.string().trim().min(1).max(100).optional(),
  travel_mode: z.enum(['DRIVE', 'BICYCLE', 'WALK', 'TWO_WHEELER']).optional(),
  target_count: z.number().int().min(1).max(100).optional(),
  route_order_diff_count: z.number().int().min(0).max(100).optional(),
});

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
  confirmation_context: routeOrderConfirmationContextSchema.optional(),
});

type VisitScheduleReorderError =
  | 'not_found'
  | 'pharmacist_change_forbidden'
  | 'invalid_pharmacist'
  | 'confirmed_move'
  | 'shift_conflict'
  | 'confirmation_context_mismatch'
  | 'duplicate_route_order';
type VisitScheduleReorderResult =
  | { error: Exclude<VisitScheduleReorderError, 'shift_conflict'> }
  | { error: 'shift_conflict'; message: string }
  | { case_ids: string[]; schedule_ids: string[] };

class VisitScheduleReorderConflictError extends Error {
  constructor() {
    super('visit schedule reorder target changed before guarded write');
    this.name = 'VisitScheduleReorderConflictError';
  }
}

class VisitScheduleReorderRetryLimitError extends Error {
  constructor() {
    super('visit schedule reorder transaction retry limit exceeded');
    this.name = 'VisitScheduleReorderRetryLimitError';
  }
}

function isSerializableTransactionConflict(cause: unknown) {
  return cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2034';
}

async function withSerializableVisitScheduleReorderTransaction<T>(
  orgId: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  for (let attempt = 0; attempt < VISIT_SCHEDULE_REORDER_SERIALIZABLE_RETRY_LIMIT; attempt += 1) {
    try {
      return await withOrgContext(orgId, work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (cause) {
      if (!isSerializableTransactionConflict(cause)) {
        throw cause;
      }
      if (attempt === VISIT_SCHEDULE_REORDER_SERIALIZABLE_RETRY_LIMIT - 1) {
        throw new VisitScheduleReorderRetryLimitError();
      }
    }
  }

  throw new VisitScheduleReorderRetryLimitError();
}

export const PATCH = withAuthContext(
  async (req: NextRequest, ctx: AuthContext) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = visitScheduleReorderSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const dedupedUpdates = Array.from(
      new Map(parsed.data.updates.map((item) => [item.schedule_id, item])).values(),
    );
    if (dedupedUpdates.length !== parsed.data.updates.length) {
      return validationError('同じ訪問予定を複数回指定できません');
    }
    const uniqueScheduleIds = dedupedUpdates.map((item) => item.schedule_id);

    let result: VisitScheduleReorderResult;
    try {
      result = await withSerializableVisitScheduleReorderTransaction<VisitScheduleReorderResult>(
        ctx.orgId,
        async (tx) => {
          const assignmentWhere = buildVisitScheduleAssignmentWhere(ctx);
          const schedules = await tx.visitSchedule.findMany({
            where: {
              org_id: ctx.orgId,
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
              version: true,
            },
          });

          if (schedules.length !== uniqueScheduleIds.length) {
            return { error: 'not_found' as const };
          }

          const scheduleById = new Map(schedules.map((schedule) => [schedule.id, schedule]));
          if (!canBypassVisitScheduleAssignmentAccess(ctx)) {
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
                org_id: ctx.orgId,
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

          const confirmationContext = parsed.data.confirmation_context;
          const routeDates = Array.from(new Set(routeCells.map((cell) => cell.scheduledDate)));
          const routePharmacistIds = Array.from(
            new Set(routeCells.map((cell) => cell.pharmacistId)),
          );
          if (
            confirmationContext &&
            ((confirmationContext.target_count &&
              confirmationContext.target_count !== uniqueScheduleIds.length) ||
              (confirmationContext.date &&
                routeDates.length === 1 &&
                confirmationContext.date !== routeDates[0]) ||
              (confirmationContext.pharmacist_id &&
                routePharmacistIds.length === 1 &&
                confirmationContext.pharmacist_id !== routePharmacistIds[0]))
          ) {
            return { error: 'confirmation_context_mismatch' as const };
          }

          const existingRouteOrderConflict = await tx.visitSchedule.findFirst({
            where: {
              org_id: ctx.orgId,
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

          const existingProposalRouteOrderConflict = await tx.visitScheduleProposal.findFirst({
            where: {
              org_id: ctx.orgId,
              finalized_schedule_id: null,
              proposal_status: { in: OPEN_PROPOSAL_STATUSES },
              OR: routeCells.map((cell) => ({
                proposed_pharmacist_id: cell.pharmacistId,
                proposed_date: new Date(cell.scheduledDate),
                route_order: cell.routeOrder,
              })),
            },
            select: { id: true },
          });
          if (existingProposalRouteOrderConflict) {
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
                    org_id: ctx.orgId,
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
            const shift =
              shiftByTarget.get(`${item.targetPharmacistId}:${item.targetDate}`) ?? null;
            return validateScheduleTimeDatesFitShift(
              shift,
              item.schedule.time_window_start,
              item.schedule.time_window_end,
            );
          });
          if (shiftConflict) {
            const shift =
              shiftByTarget.get(
                `${shiftConflict.targetPharmacistId}:${shiftConflict.targetDate}`,
              ) ?? null;
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
            dedupedUpdates.map(async (item) => {
              const schedule = scheduleById.get(item.schedule_id);
              const targetDate =
                item.scheduled_date ??
                (schedule ? formatDateKey(schedule.scheduled_date) : undefined);
              const targetPharmacistId = item.pharmacist_id ?? schedule?.pharmacist_id;
              const targetShift =
                targetDate && targetPharmacistId
                  ? (shiftByTarget.get(`${targetPharmacistId}:${targetDate}`) ?? null)
                  : null;

              if (!schedule || !targetDate || !targetPharmacistId) {
                throw new VisitScheduleReorderConflictError();
              }

              const updateResult = await tx.visitSchedule.updateMany({
                where: {
                  org_id: ctx.orgId,
                  id: item.schedule_id,
                  pharmacist_id: schedule.pharmacist_id,
                  scheduled_date: schedule.scheduled_date,
                  confirmed_at: schedule.confirmed_at,
                  version: schedule.version,
                  ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
                },
                data: {
                  route_order: item.route_order,
                  ...(item.scheduled_date ? { scheduled_date: new Date(item.scheduled_date) } : {}),
                  ...(item.pharmacist_id ? { pharmacist_id: item.pharmacist_id } : {}),
                  ...(targetShift ? { site_id: targetShift.site_id } : {}),
                  version: { increment: 1 },
                },
              });
              if (updateResult.count !== 1) throw new VisitScheduleReorderConflictError();
            }),
          );

          await createAuditLogEntry(tx, ctx, {
            action: 'visit_schedules_reordered',
            targetType: 'VisitScheduleBatch',
            targetId: uniqueScheduleIds[0],
            changes: {
              updates: dedupedUpdates.map((item) => ({
                schedule_id: item.schedule_id,
                route_order: item.route_order,
                scheduled_date: item.scheduled_date ?? null,
                pharmacist_id: item.pharmacist_id ?? null,
              })),
              confirmation_context: parsed.data.confirmation_context ?? null,
            },
          });

          return {
            case_ids: Array.from(new Set(schedules.map((schedule) => schedule.case_id))),
            schedule_ids: uniqueScheduleIds,
          };
        },
      );
    } catch (cause) {
      if (
        cause instanceof VisitScheduleReorderConflictError ||
        cause instanceof VisitScheduleReorderRetryLimitError
      ) {
        return conflict('route_order の反映対象が同時に更新されました。再読み込みしてください');
      }
      throw cause;
    }

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
      if (result.error === 'confirmation_context_mismatch') {
        return validationError('確認コンテキストが訪問予定の対象セルと一致しません');
      }
      if (result.error === 'duplicate_route_order') {
        return validationError('同一セル内で route_order は重複できません');
      }
      return validationError('訪問予定の並べ替えに失敗しました');
    }

    const successfulResult = result;
    await Promise.all(
      successfulResult.case_ids.map((caseId) =>
        notifyWorkflowMutation({
          orgId: ctx.orgId,
          payload: { source: 'visit_schedules_reorder', case_id: caseId },
        }),
      ),
    );

    return success(successfulResult);
  },
  {
    permission: 'canVisit',
    message: '訪問予定の更新権限がありません',
  },
);
