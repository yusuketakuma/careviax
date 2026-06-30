import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError, notFound, conflict, internalError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { buildVisitScheduleProposalAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { formatUtcDateKey } from '@/lib/date-key';
import { dateKeySchema } from '@/lib/validations/date-key';
import {
  findVisitRouteOrderConflict,
  hasDuplicateVisitRouteOrderCells,
} from '@/lib/visits/route-order-conflicts';
import { OPEN_VISIT_SCHEDULE_PROPOSAL_STATUSES as OPEN_PROPOSAL_STATUSES } from '@/lib/visit-schedule-proposals/route-order';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';

const PROPOSAL_ROUTE_REORDER_SERIALIZABLE_RETRY_LIMIT = 3;

const routeOrderConfirmationContextSchema = z.object({
  source: z.enum(['proposal_detail_route_preview']),
  date: dateKeySchema('確認日付の形式が不正です（YYYY-MM-DD）').optional(),
  pharmacist_id: z.string().trim().min(1).max(100).optional(),
  travel_mode: z.enum(['DRIVE', 'BICYCLE', 'WALK', 'TWO_WHEELER']).optional(),
  target_count: z.number().int().min(1).max(100).optional(),
  route_order_diff_count: z.number().int().min(0).max(100).optional(),
});

const proposalRouteOrderUpdateSchema = z.object({
  proposal_id: z.string().trim().min(1),
  route_order: z.number().int().min(1),
  expected_route_order: z.number().int().min(1).nullable().optional(),
});
type ProposalRouteOrderUpdate = z.infer<typeof proposalRouteOrderUpdateSchema>;

const reorderVisitScheduleProposalSchema = z.union([
  z.object({
    ordered_proposal_ids: z.array(z.string().trim().min(1)).min(1),
    confirmation_context: routeOrderConfirmationContextSchema.optional(),
  }),
  z.object({
    route_order_updates: z.array(proposalRouteOrderUpdateSchema).min(1),
    confirmation_context: routeOrderConfirmationContextSchema.optional(),
  }),
]);

type ProposalRouteReorderError =
  | 'not_found'
  | 'locked'
  | 'mismatch'
  | 'stale_route_order'
  | 'confirmation_context_mismatch'
  | 'duplicate_route_order';
type ProposalRouteReorderResult =
  | { error: ProposalRouteReorderError }
  | { case_ids: string[]; ordered_proposal_ids: string[] };

class ProposalRouteReorderConflictError extends Error {
  constructor() {
    super('proposal route reorder target changed before guarded write');
    this.name = 'ProposalRouteReorderConflictError';
  }
}

class ProposalRouteReorderRetryLimitError extends Error {
  constructor() {
    super('proposal route reorder transaction retry limit exceeded');
    this.name = 'ProposalRouteReorderRetryLimitError';
  }
}

function hasDuplicateValue(values: string[]) {
  return new Set(values).size !== values.length;
}

function isSerializableTransactionConflict(cause: unknown) {
  return cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2034';
}

async function withSerializableProposalRouteReorderTransaction<T>(
  orgId: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  for (let attempt = 0; attempt < PROPOSAL_ROUTE_REORDER_SERIALIZABLE_RETRY_LIMIT; attempt += 1) {
    try {
      return await withOrgContext(orgId, work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (cause) {
      if (!isSerializableTransactionConflict(cause)) {
        throw cause;
      }
      if (attempt === PROPOSAL_ROUTE_REORDER_SERIALIZABLE_RETRY_LIMIT - 1) {
        throw new ProposalRouteReorderRetryLimitError();
      }
    }
  }

  throw new ProposalRouteReorderRetryLimitError();
}

const authenticatedPATCH = withAuthContext(
  async (req: NextRequest, ctx: AuthContext) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = reorderVisitScheduleProposalSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const orderedInput =
      'ordered_proposal_ids' in parsed.data ? parsed.data.ordered_proposal_ids : null;
    const explicitInput =
      'route_order_updates' in parsed.data ? parsed.data.route_order_updates : null;
    const mode = orderedInput ? 'ordered' : 'explicit';
    const inputIds = orderedInput
      ? orderedInput
      : (explicitInput ?? []).map((item) => item.proposal_id);
    if (hasDuplicateValue(inputIds)) {
      return validationError('同じ訪問候補を複数回指定できません');
    }
    const orderedIds = orderedInput
      ? orderedInput
      : (explicitInput ?? []).map((item) => item.proposal_id);
    const explicitUpdates: ProposalRouteOrderUpdate[] | null = explicitInput
      ? explicitInput.map((item) => ({
          proposal_id: item.proposal_id,
          route_order: item.route_order,
          ...(item.expected_route_order !== undefined
            ? { expected_route_order: item.expected_route_order }
            : {}),
        }))
      : null;

    let result: ProposalRouteReorderResult;
    try {
      result = await withSerializableProposalRouteReorderTransaction<ProposalRouteReorderResult>(
        ctx.orgId,
        async (tx) => {
          const assignmentWhere = buildVisitScheduleProposalAssignmentWhere(ctx);
          const proposals = await tx.visitScheduleProposal.findMany({
            where: {
              org_id: ctx.orgId,
              id: { in: orderedIds },
              ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
            },
            select: {
              id: true,
              case_id: true,
              proposed_date: true,
              proposed_pharmacist_id: true,
              finalized_schedule_id: true,
              proposal_status: true,
              route_order: true,
            },
          });

          if (proposals.length !== orderedIds.length) {
            return { error: 'not_found' as const };
          }

          const [first] = proposals;
          const firstDateKey = formatUtcDateKey(first.proposed_date);
          const mismatch = proposals.find((proposal) => {
            if (proposal.proposed_pharmacist_id !== first.proposed_pharmacist_id) return true;
            if (proposal.proposed_date.getTime() !== first.proposed_date.getTime()) return true;
            if (mode === 'ordered' && proposal.case_id !== first.case_id) return true;
            return false;
          });
          if (mismatch) {
            return { error: 'mismatch' as const };
          }
          const proposalById = new Map(proposals.map((proposal) => [proposal.id, proposal]));
          const staleRouteOrder = explicitUpdates?.find((item) => {
            if (item.expected_route_order === undefined) return false;
            return proposalById.get(item.proposal_id)?.route_order !== item.expected_route_order;
          });
          if (staleRouteOrder) {
            return { error: 'stale_route_order' as const };
          }

          const confirmationContext = parsed.data.confirmation_context;
          if (
            confirmationContext &&
            ((confirmationContext.date && confirmationContext.date !== firstDateKey) ||
              (confirmationContext.pharmacist_id &&
                confirmationContext.pharmacist_id !== first.proposed_pharmacist_id) ||
              (confirmationContext.target_count &&
                confirmationContext.target_count !== orderedIds.length))
          ) {
            return { error: 'confirmation_context_mismatch' as const };
          }

          const locked = proposals.find(
            (proposal) =>
              proposal.finalized_schedule_id != null ||
              !OPEN_PROPOSAL_STATUSES.includes(proposal.proposal_status),
          );
          if (locked) {
            return { error: 'locked' as const };
          }

          const updates: ProposalRouteOrderUpdate[] =
            mode === 'ordered'
              ? orderedIds.map((proposalId, index) => ({
                  proposal_id: proposalId,
                  route_order: index + 1,
                }))
              : (explicitUpdates ?? []);

          const routeOrderCells = updates.map((item) => ({
            pharmacistId: first.proposed_pharmacist_id,
            dateKey: firstDateKey,
            routeOrder: item.route_order,
          }));
          if (hasDuplicateVisitRouteOrderCells(routeOrderCells)) {
            return { error: 'duplicate_route_order' as const };
          }

          const routeOrderConflict = await findVisitRouteOrderConflict(tx, {
            orgId: ctx.orgId,
            cells: routeOrderCells,
            excludeProposalIds: orderedIds,
          });
          if (routeOrderConflict) {
            return { error: 'duplicate_route_order' as const };
          }

          await Promise.all(
            updates.map(async (item) => {
              const updateResult = await tx.visitScheduleProposal.updateMany({
                where: {
                  org_id: ctx.orgId,
                  id: item.proposal_id,
                  proposed_pharmacist_id: first.proposed_pharmacist_id,
                  proposed_date: new Date(firstDateKey),
                  ...(item.expected_route_order !== undefined
                    ? { route_order: item.expected_route_order }
                    : {}),
                  finalized_schedule_id: null,
                  proposal_status: { in: OPEN_PROPOSAL_STATUSES },
                  ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
                },
                data: { route_order: item.route_order },
              });
              if (updateResult.count !== 1) throw new ProposalRouteReorderConflictError();
            }),
          );

          await createAuditLogEntry(tx, ctx, {
            action: 'visit_schedule_proposals_reordered',
            targetType:
              mode === 'ordered' ? 'VisitScheduleProposalBatch' : 'VisitScheduleProposalRouteBatch',
            targetId:
              mode === 'ordered'
                ? first.case_id
                : `${first.proposed_pharmacist_id}:${first.proposed_date.toISOString()}`,
            changes: {
              ordered_proposal_ids: orderedIds,
              route_order_updates:
                mode === 'explicit'
                  ? updates.map((item) => ({
                      proposal_id: item.proposal_id,
                      previous_route_order: proposalById.get(item.proposal_id)?.route_order ?? null,
                      route_order: item.route_order,
                      ...(item.expected_route_order !== undefined
                        ? { expected_route_order: item.expected_route_order }
                        : {}),
                    }))
                  : undefined,
              proposed_date: first.proposed_date.toISOString(),
              pharmacist_id: first.proposed_pharmacist_id,
              confirmation_context: parsed.data.confirmation_context ?? null,
            },
          });

          return {
            case_ids: Array.from(new Set(proposals.map((proposal) => proposal.case_id))),
            ordered_proposal_ids: orderedIds,
          };
        },
      );
    } catch (cause) {
      if (
        cause instanceof ProposalRouteReorderConflictError ||
        cause instanceof ProposalRouteReorderRetryLimitError
      ) {
        return conflict('route_order の反映対象が同時に更新されました。再読み込みしてください');
      }
      throw cause;
    }

    if ('error' in result) {
      if (result.error === 'not_found') {
        return notFound('対象の訪問候補が見つかりません');
      }
      if (result.error === 'mismatch') {
        return validationError(
          mode === 'ordered'
            ? '同一ケース・同一薬剤師・同一日の候補のみ並べ替えできます'
            : '同一薬剤師・同一日の候補のみ route_order を更新できます',
        );
      }
      if (result.error === 'locked') {
        return validationError('確定済みまたは却下済みの候補は並べ替えできません');
      }
      if (result.error === 'stale_route_order') {
        return conflict('route_order の反映対象が同時に更新されました。再読み込みしてください');
      }
      if (result.error === 'confirmation_context_mismatch') {
        return validationError('確認コンテキストが訪問候補の対象セルと一致しません');
      }
      if (result.error === 'duplicate_route_order') {
        return validationError('route_order は重複できません');
      }
      return validationError('訪問候補の並べ替えに失敗しました');
    }

    const successfulResult = result;
    await Promise.all(
      successfulResult.case_ids.map((caseId) =>
        notifyWorkflowMutation({
          orgId: ctx.orgId,
          payload: { source: 'visit_schedule_proposals_reorder', case_id: caseId },
        }),
      ),
    );

    return success(successfulResult);
  },
  {
    permission: 'canVisit',
    message: '訪問候補の更新権限がありません',
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
