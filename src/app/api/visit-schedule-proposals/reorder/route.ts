import { z } from 'zod';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError, notFound } from '@/lib/api/response';
import { buildVisitScheduleProposalAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { dateKeySchema } from '@/lib/validations/date-key';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';

const routeOrderConfirmationContextSchema = z.object({
  source: z.string().trim().min(1).max(80),
  date: dateKeySchema('確認日付の形式が不正です（YYYY-MM-DD）').optional(),
  pharmacist_id: z.string().trim().min(1).max(100).optional(),
  travel_mode: z.enum(['DRIVE', 'BICYCLE', 'WALK', 'TWO_WHEELER']).optional(),
  target_count: z.number().int().min(1).max(100).optional(),
  route_order_diff_count: z.number().int().min(0).max(100).optional(),
});

const proposalRouteOrderUpdateSchema = z.object({
  proposal_id: z.string().trim().min(1),
  route_order: z.number().int().min(1),
});

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

export const PATCH = withAuth(
  async (req: AuthenticatedRequest) => {
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
    const orderedIds = orderedInput
      ? Array.from(new Set(orderedInput))
      : Array.from(new Set((explicitInput ?? []).map((item) => item.proposal_id)));
    const explicitUpdates = explicitInput
      ? Array.from(
          new Map(
            explicitInput.map((item) => [item.proposal_id, item.route_order] as const),
          ).entries(),
        ).map(([proposalId, routeOrder]) => ({
          proposal_id: proposalId,
          route_order: routeOrder,
        }))
      : null;

    const result = await withOrgContext(req.orgId, async (tx) => {
      const assignmentWhere = buildVisitScheduleProposalAssignmentWhere(req);
      const proposals = await tx.visitScheduleProposal.findMany({
        where: {
          org_id: req.orgId,
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
        },
      });

      if (proposals.length !== orderedIds.length) {
        return { error: 'not_found' as const };
      }

      const [first] = proposals;
      const mismatch = proposals.find((proposal) => {
        if (proposal.proposed_pharmacist_id !== first.proposed_pharmacist_id) return true;
        if (proposal.proposed_date.getTime() !== first.proposed_date.getTime()) return true;
        if (mode === 'ordered' && proposal.case_id !== first.case_id) return true;
        return false;
      });
      if (mismatch) {
        return { error: 'mismatch' as const };
      }

      const locked = proposals.find(
        (proposal) =>
          proposal.finalized_schedule_id != null ||
          ['confirmed', 'rejected', 'superseded', 'expired'].includes(proposal.proposal_status),
      );
      if (locked) {
        return { error: 'locked' as const };
      }

      const updates =
        mode === 'ordered'
          ? orderedIds.map((proposalId, index) => ({
              proposal_id: proposalId,
              route_order: index + 1,
            }))
          : (explicitUpdates ?? []);

      const duplicateRouteOrder = new Set<number>();
      const hasDuplicateRouteOrder = updates.some((item) => {
        if (duplicateRouteOrder.has(item.route_order)) return true;
        duplicateRouteOrder.add(item.route_order);
        return false;
      });
      if (hasDuplicateRouteOrder) {
        return { error: 'duplicate_route_order' as const };
      }

      await Promise.all(
        updates.map((item) =>
          tx.visitScheduleProposal.update({
            where: { id: item.proposal_id },
            data: { route_order: item.route_order },
          }),
        ),
      );

      await tx.auditLog.create({
        data: {
          org_id: req.orgId,
          actor_id: req.userId,
          action: 'visit_schedule_proposals_reordered',
          target_type:
            mode === 'ordered' ? 'VisitScheduleProposalBatch' : 'VisitScheduleProposalRouteBatch',
          target_id:
            mode === 'ordered'
              ? first.case_id
              : `${first.proposed_pharmacist_id}:${first.proposed_date.toISOString()}`,
          changes: {
            ordered_proposal_ids: orderedIds,
            route_order_updates:
              mode === 'explicit'
                ? updates.map((item) => ({
                    proposal_id: item.proposal_id,
                    route_order: item.route_order,
                  }))
                : undefined,
            proposed_date: first.proposed_date.toISOString(),
            pharmacist_id: first.proposed_pharmacist_id,
            confirmation_context: parsed.data.confirmation_context ?? null,
          },
        },
      });

      return {
        case_ids: Array.from(new Set(proposals.map((proposal) => proposal.case_id))),
        ordered_proposal_ids: orderedIds,
      };
    });

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
      if (result.error === 'duplicate_route_order') {
        return validationError('route_order は重複できません');
      }
    }

    await Promise.all(
      result.case_ids.map((caseId) =>
        notifyWorkflowMutation({
          orgId: req.orgId,
          payload: { source: 'visit_schedule_proposals_reorder', case_id: caseId },
        }),
      ),
    );

    return success(result);
  },
  {
    permission: 'canVisit',
    message: '訪問候補の更新権限がありません',
  },
);
