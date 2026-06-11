import { z } from 'zod';
import { Prisma, type VisitProposalStatus } from '@prisma/client';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError, notFound, conflict } from '@/lib/api/response';
import { formatDateKey } from '@/lib/date-key';
import { withOrgContext } from '@/lib/db/rls';
import {
  buildVisitScheduleAssignmentWhere,
  buildVisitScheduleProposalAssignmentWhere,
} from '@/lib/auth/visit-schedule-access';
import { visitScheduleDateKeySchema } from '@/lib/validations/visit-schedule';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';

const OPEN_PROPOSAL_STATUSES: VisitProposalStatus[] = [
  'proposed',
  'patient_contact_pending',
  'reschedule_pending',
];
const MIXED_ROUTE_REORDER_SERIALIZABLE_RETRY_LIMIT = 3;

const routeOrderConfirmationContextSchema = z.object({
  source: z.enum(['weekly_optimizer_mixed_route_preview']),
  date: visitScheduleDateKeySchema('確認日付の形式が不正です（YYYY-MM-DD）').optional(),
  pharmacist_id: z.string().trim().min(1).max(100).optional(),
  travel_mode: z.enum(['DRIVE', 'BICYCLE', 'WALK', 'TWO_WHEELER']).optional(),
  target_count: z.number().int().min(1).max(100).optional(),
  route_order_diff_count: z.number().int().min(0).max(100).optional(),
});

const mixedRouteOrderUpdateSchema = z.object({
  item_type: z.enum(['schedule', 'proposal']),
  id: z.string().trim().min(1),
  route_order: z.number().int().min(1),
});

const mixedRouteReorderSchema = z.object({
  updates: z.array(mixedRouteOrderUpdateSchema).min(1).max(100),
  confirmation_context: routeOrderConfirmationContextSchema.optional(),
});

type MixedRouteReorderError = 'not_found' | 'locked' | 'mismatch' | 'duplicate_route_order';
type MixedRouteReorderResult =
  | { error: MixedRouteReorderError }
  | { case_ids: string[]; schedule_ids: string[]; proposal_ids: string[] };

function hasDuplicateRouteTarget(updates: Array<z.infer<typeof mixedRouteOrderUpdateSchema>>) {
  const seen = new Set<string>();
  return updates.some((item) => {
    const key = `${item.item_type}:${item.id}`;
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
}

class MixedRouteReorderConflictError extends Error {
  constructor() {
    super('mixed route reorder target changed before guarded write');
    this.name = 'MixedRouteReorderConflictError';
  }
}

class MixedRouteReorderRetryLimitError extends Error {
  constructor() {
    super('mixed route reorder transaction retry limit exceeded');
    this.name = 'MixedRouteReorderRetryLimitError';
  }
}

function isSerializableTransactionConflict(cause: unknown) {
  return cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2034';
}

async function withSerializableMixedRouteReorderTransaction<T>(
  orgId: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  for (let attempt = 0; attempt < MIXED_ROUTE_REORDER_SERIALIZABLE_RETRY_LIMIT; attempt += 1) {
    try {
      return await withOrgContext(orgId, work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (cause) {
      if (!isSerializableTransactionConflict(cause)) {
        throw cause;
      }
      if (attempt === MIXED_ROUTE_REORDER_SERIALIZABLE_RETRY_LIMIT - 1) {
        throw new MixedRouteReorderRetryLimitError();
      }
    }
  }

  throw new MixedRouteReorderRetryLimitError();
}

export const PATCH = withAuth(
  async (req: AuthenticatedRequest) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = mixedRouteReorderSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const updates = parsed.data.updates;
    if (hasDuplicateRouteTarget(updates)) {
      return validationError('同じ対象を複数回指定できません');
    }

    const scheduleUpdates = updates.filter((item) => item.item_type === 'schedule');
    const proposalUpdates = updates.filter((item) => item.item_type === 'proposal');
    const scheduleIds = scheduleUpdates.map((item) => item.id);
    const proposalIds = proposalUpdates.map((item) => item.id);

    let result: MixedRouteReorderResult;
    try {
      result = await withSerializableMixedRouteReorderTransaction<MixedRouteReorderResult>(
        req.orgId,
        async (tx) => {
          const scheduleAssignmentWhere = buildVisitScheduleAssignmentWhere(req);
          const proposalAssignmentWhere = buildVisitScheduleProposalAssignmentWhere(req);
          const [schedules, proposals] = await Promise.all([
            scheduleIds.length > 0
              ? tx.visitSchedule.findMany({
                  where: {
                    org_id: req.orgId,
                    id: { in: scheduleIds },
                    ...(scheduleAssignmentWhere ? { AND: [scheduleAssignmentWhere] } : {}),
                  },
                  select: {
                    id: true,
                    case_id: true,
                    pharmacist_id: true,
                    scheduled_date: true,
                  },
                })
              : Promise.resolve([]),
            proposalIds.length > 0
              ? tx.visitScheduleProposal.findMany({
                  where: {
                    org_id: req.orgId,
                    id: { in: proposalIds },
                    ...(proposalAssignmentWhere ? { AND: [proposalAssignmentWhere] } : {}),
                  },
                  select: {
                    id: true,
                    case_id: true,
                    proposed_date: true,
                    proposed_pharmacist_id: true,
                    finalized_schedule_id: true,
                    proposal_status: true,
                  },
                })
              : Promise.resolve([]),
          ]);

          if (schedules.length !== scheduleIds.length || proposals.length !== proposalIds.length) {
            return { error: 'not_found' as const };
          }

          const lockedProposal = proposals.find(
            (proposal) =>
              proposal.finalized_schedule_id != null ||
              !OPEN_PROPOSAL_STATUSES.includes(proposal.proposal_status),
          );
          if (lockedProposal) return { error: 'locked' as const };

          const scheduleById = new Map(schedules.map((schedule) => [schedule.id, schedule]));
          const proposalById = new Map(proposals.map((proposal) => [proposal.id, proposal]));
          const routeCells = updates.map((item) => {
            if (item.item_type === 'schedule') {
              const schedule = scheduleById.get(item.id);
              if (!schedule) return null;
              return {
                itemType: item.item_type,
                id: item.id,
                caseId: schedule.case_id,
                pharmacistId: schedule.pharmacist_id,
                dateKey: formatDateKey(schedule.scheduled_date),
                routeOrder: item.route_order,
              };
            }

            const proposal = proposalById.get(item.id);
            if (!proposal) return null;
            return {
              itemType: item.item_type,
              id: item.id,
              caseId: proposal.case_id,
              pharmacistId: proposal.proposed_pharmacist_id,
              dateKey: formatDateKey(proposal.proposed_date),
              routeOrder: item.route_order,
            };
          });

          if (routeCells.some((item) => item == null)) {
            return { error: 'not_found' as const };
          }

          const typedRouteCells = routeCells.filter((item): item is NonNullable<typeof item> =>
            Boolean(item),
          );
          const [firstCell] = typedRouteCells;
          const mismatch = typedRouteCells.find(
            (item) =>
              item.pharmacistId !== firstCell.pharmacistId || item.dateKey !== firstCell.dateKey,
          );
          if (mismatch) return { error: 'mismatch' as const };

          const routeOrders = typedRouteCells.map((item) => item.routeOrder);
          if (new Set(routeOrders).size !== routeOrders.length) {
            return { error: 'duplicate_route_order' as const };
          }

          const [scheduleConflict, proposalConflict] = await Promise.all([
            tx.visitSchedule.findFirst({
              where: {
                org_id: req.orgId,
                pharmacist_id: firstCell.pharmacistId,
                scheduled_date: new Date(firstCell.dateKey),
                route_order: { in: routeOrders },
                ...(scheduleIds.length > 0 ? { id: { notIn: scheduleIds } } : {}),
              },
              select: { id: true },
            }),
            tx.visitScheduleProposal.findFirst({
              where: {
                org_id: req.orgId,
                proposed_pharmacist_id: firstCell.pharmacistId,
                proposed_date: new Date(firstCell.dateKey),
                route_order: { in: routeOrders },
                finalized_schedule_id: null,
                proposal_status: { in: OPEN_PROPOSAL_STATUSES },
                ...(proposalIds.length > 0 ? { id: { notIn: proposalIds } } : {}),
              },
              select: { id: true },
            }),
          ]);
          if (scheduleConflict || proposalConflict) {
            return { error: 'duplicate_route_order' as const };
          }

          await Promise.all(
            scheduleUpdates.map(async (item) => {
              const updateResult = await tx.visitSchedule.updateMany({
                where: {
                  org_id: req.orgId,
                  id: item.id,
                  pharmacist_id: firstCell.pharmacistId,
                  scheduled_date: new Date(firstCell.dateKey),
                  ...(scheduleAssignmentWhere ? { AND: [scheduleAssignmentWhere] } : {}),
                },
                data: {
                  route_order: item.route_order,
                  version: { increment: 1 },
                },
              });
              if (updateResult.count !== 1) throw new MixedRouteReorderConflictError();
            }),
          );

          await Promise.all(
            proposalUpdates.map(async (item) => {
              const updateResult = await tx.visitScheduleProposal.updateMany({
                where: {
                  org_id: req.orgId,
                  id: item.id,
                  proposed_pharmacist_id: firstCell.pharmacistId,
                  proposed_date: new Date(firstCell.dateKey),
                  finalized_schedule_id: null,
                  proposal_status: { in: OPEN_PROPOSAL_STATUSES },
                  ...(proposalAssignmentWhere ? { AND: [proposalAssignmentWhere] } : {}),
                },
                data: { route_order: item.route_order },
              });
              if (updateResult.count !== 1) throw new MixedRouteReorderConflictError();
            }),
          );

          await tx.auditLog.create({
            data: {
              org_id: req.orgId,
              actor_id: req.userId,
              action: 'visit_routes_mixed_reordered',
              target_type: 'VisitRouteMixedCell',
              target_id: `${firstCell.pharmacistId}:${firstCell.dateKey}`,
              changes: {
                date: firstCell.dateKey,
                pharmacist_id: firstCell.pharmacistId,
                schedule_updates: scheduleUpdates.map((item) => ({
                  schedule_id: item.id,
                  route_order: item.route_order,
                })),
                proposal_updates: proposalUpdates.map((item) => ({
                  proposal_id: item.id,
                  route_order: item.route_order,
                })),
                confirmation_context: parsed.data.confirmation_context ?? null,
              },
            },
          });

          return {
            case_ids: Array.from(new Set(typedRouteCells.map((item) => item.caseId))),
            schedule_ids: scheduleIds,
            proposal_ids: proposalIds,
          };
        },
      );
    } catch (cause) {
      if (
        cause instanceof MixedRouteReorderConflictError ||
        cause instanceof MixedRouteReorderRetryLimitError
      ) {
        return conflict('route_order の反映対象が同時に更新されました。再読み込みしてください');
      }
      throw cause;
    }

    if ('error' in result) {
      if (result.error === 'not_found') {
        return notFound('対象の訪問予定または候補が見つかりません');
      }
      if (result.error === 'locked') {
        return validationError('確定済みまたは却下済みの候補は並べ替えできません');
      }
      if (result.error === 'mismatch') {
        return validationError('同一薬剤師・同一日の訪問予定と候補のみ route_order を更新できます');
      }
      if (result.error === 'duplicate_route_order') {
        return validationError('同一セル内で route_order は重複できません');
      }
      return validationError('route_order の更新に失敗しました');
    }

    const successfulResult = result;
    await Promise.all(
      successfulResult.case_ids.map((caseId) =>
        notifyWorkflowMutation({
          orgId: req.orgId,
          payload: { source: 'visit_routes_mixed_reorder', case_id: caseId },
        }),
      ),
    );

    return success({
      schedule_ids: successfulResult.schedule_ids,
      proposal_ids: successfulResult.proposal_ids,
    });
  },
  {
    permission: 'canVisit',
    message: '混在ルート順の更新権限がありません',
  },
);
