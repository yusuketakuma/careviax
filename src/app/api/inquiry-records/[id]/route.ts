import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { requireAuthContext } from '@/lib/auth/context';
import { canFinalizeClinicalState } from '@/lib/auth/clinical-finalization';
import { withOrgContext } from '@/lib/db/rls';
import {
  success,
  validationError,
  notFound,
  conflict,
  internalError,
  forbiddenResponse,
} from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { updateInquiryRecordSchema } from '@/lib/validations/prescription';
import { prisma } from '@/lib/db/client';
import { resolveOperationalTasks } from '@/server/services/operational-tasks';
import { buildMedicationCycleAssignmentWhere } from '@/server/services/prescription-access';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import { logger } from '@/lib/utils/logger';
import type { InquiryRecord } from '@prisma/client';
import type { UpdateInquiryRecordInput } from '@/lib/validations/prescription';

const ROUTE = '/api/inquiry-records/[id]';

const inquiryLineAuditFields = [
  'drug_name',
  'drug_code',
  'dose',
  'frequency',
  'days',
  'packaging_instructions',
  'route',
] as const;

type InquiryLineAuditField = (typeof inquiryLineAuditFields)[number];
type InquiryLineAuditValue = string | number | null;
type InquiryLineAuditBefore = Record<InquiryLineAuditField, InquiryLineAuditValue>;
type InquiryLineSnapshot = InquiryLineAuditBefore & { updated_at: Date };
type InquiryLineUpdateInput = NonNullable<UpdateInquiryRecordInput['line_update']>;
type InquiryLineUpdateAudit = Partial<Record<InquiryLineAuditField, { changed: true }>>;
type InquiryPatchResult =
  | { inquiry: InquiryRecord }
  | {
      error: 'line_not_found' | 'line_update_no_changes' | 'inquiry_not_found' | 'conflict';
      message?: string;
    };

class InquiryPatchConflictError extends Error {}

function touchesInquiryClinicalFinalization(patch: UpdateInquiryRecordInput) {
  return (
    patch.result !== undefined || patch.resolved_at !== undefined || patch.line_update !== undefined
  );
}

function touchesInquiryFinalizedMetadata(patch: UpdateInquiryRecordInput) {
  return (
    patch.change_detail !== undefined ||
    patch.proposal_origin !== undefined ||
    patch.residual_adjustment !== undefined
  );
}

function isFinalInquiryResult(result: string | null) {
  return result === 'changed' || result === 'unchanged';
}

function buildInquiryLineUpdateAudit(
  before: InquiryLineAuditBefore | null,
  update: InquiryLineUpdateInput | undefined,
) {
  if (!before || !update) return null;

  const audit: InquiryLineUpdateAudit = {};

  for (const field of inquiryLineAuditFields) {
    const after = update[field];
    if (after !== undefined && before[field] !== after) {
      audit[field] = { changed: true };
    }
  }

  return Object.keys(audit).length > 0 ? audit : null;
}

async function authenticatedPATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '問い合わせ記録の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('疑義照会記録IDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = updateInquiryRecordSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  if (touchesInquiryClinicalFinalization(parsed.data) && !canFinalizeClinicalState(ctx.role)) {
    return forbiddenResponse('疑義照会結果の確定・処方反映権限がありません');
  }

  if (parsed.data.line_update && Object.keys(parsed.data.line_update).length === 0) {
    return validationError('処方明細の更新内容が空です');
  }

  const cycleAssignmentWhere = buildMedicationCycleAssignmentWhere(ctx);

  const existing = await prisma.inquiryRecord.findFirst({
    where: {
      id,
      org_id: ctx.orgId,
      ...(cycleAssignmentWhere ? { cycle: cycleAssignmentWhere } : {}),
    },
    select: {
      id: true,
      cycle_id: true,
      line_id: true,
      issue_id: true,
      result: true,
      updated_at: true,
      cycle: {
        select: {
          overall_status: true,
        },
      },
    },
  });
  if (!existing) return notFound('疑義照会記録が見つかりません');

  if (
    !canFinalizeClinicalState(ctx.role) &&
    isFinalInquiryResult(existing.result) &&
    touchesInquiryFinalizedMetadata(parsed.data)
  ) {
    return forbiddenResponse('確定済み疑義照会記録の更新権限がありません');
  }

  const { result, change_detail, proposal_origin, residual_adjustment, resolved_at, line_update } =
    parsed.data;
  const resolvedAt =
    resolved_at != null
      ? new Date(resolved_at)
      : result === 'changed' || result === 'unchanged'
        ? new Date()
        : undefined;

  if (line_update && result !== 'changed') {
    return validationError('処方明細の更新内容は変更ありの場合のみ指定できます');
  }

  if (line_update && !existing.line_id) {
    return validationError('処方明細の更新内容は明細に紐づく疑義照会でのみ指定できます');
  }

  if (result === 'changed' && existing.line_id && !line_update) {
    return validationError('変更ありで確定する場合は処方明細の更新内容が必要です');
  }

  const inquiryResult = await withOrgContext(
    ctx.orgId,
    async (tx): Promise<InquiryPatchResult> => {
      let lineUpdateAudit: ReturnType<typeof buildInquiryLineUpdateAudit> = null;
      let lineSnapshot: InquiryLineSnapshot | null = null;

      if (existing.line_id) {
        const line = await tx.prescriptionLine.findFirst({
          where: {
            id: existing.line_id,
            org_id: ctx.orgId,
            intake: {
              cycle_id: existing.cycle_id,
            },
          },
          select: {
            id: true,
            drug_name: true,
            drug_code: true,
            dose: true,
            frequency: true,
            days: true,
            packaging_instructions: true,
            route: true,
            updated_at: true,
          },
        });
        if (!line) {
          return { error: 'line_not_found' as const };
        }

        lineSnapshot = {
          drug_name: line.drug_name,
          drug_code: line.drug_code,
          dose: line.dose,
          frequency: line.frequency,
          days: line.days,
          packaging_instructions: line.packaging_instructions,
          route: line.route,
          updated_at: line.updated_at,
        };

        lineUpdateAudit = buildInquiryLineUpdateAudit(lineSnapshot, line_update);
        if (result === 'changed' && line_update && !lineUpdateAudit) {
          return { error: 'line_update_no_changes' as const };
        }
      }

      if (result === 'changed' && existing.line_id && line_update && lineSnapshot) {
        const lineUpdateResult = await tx.prescriptionLine.updateMany({
          where: {
            id: existing.line_id,
            org_id: ctx.orgId,
            updated_at: lineSnapshot.updated_at,
            intake: {
              cycle_id: existing.cycle_id,
            },
          },
          data: {
            ...(line_update.drug_name !== undefined ? { drug_name: line_update.drug_name } : {}),
            ...(line_update.drug_code !== undefined ? { drug_code: line_update.drug_code } : {}),
            ...(line_update.dose !== undefined ? { dose: line_update.dose } : {}),
            ...(line_update.frequency !== undefined ? { frequency: line_update.frequency } : {}),
            ...(line_update.days !== undefined ? { days: line_update.days } : {}),
            ...(line_update.packaging_instructions !== undefined
              ? { packaging_instructions: line_update.packaging_instructions }
              : {}),
            ...(line_update.route !== undefined ? { route: line_update.route } : {}),
          },
        });
        if (lineUpdateResult.count !== 1) {
          throw new InquiryPatchConflictError(
            '処方明細が他のユーザーによって更新されています。最新のデータを取得してください。',
          );
        }
      }

      const inquiryUpdateResult = await tx.inquiryRecord.updateMany({
        where: {
          id,
          org_id: ctx.orgId,
          updated_at: existing.updated_at,
        },
        data: {
          ...(result !== undefined ? { result } : {}),
          ...(change_detail !== undefined ? { change_detail } : {}),
          ...(proposal_origin !== undefined ? { proposal_origin } : {}),
          ...(residual_adjustment !== undefined ? { residual_adjustment } : {}),
          ...(result === 'pending'
            ? { resolved_at: null }
            : resolvedAt
              ? { resolved_at: resolvedAt }
              : {}),
        },
      });
      if (inquiryUpdateResult.count !== 1) {
        throw new InquiryPatchConflictError(
          '疑義照会記録が他のユーザーによって更新されています。最新のデータを取得してください。',
        );
      }

      const updated = await tx.inquiryRecord.findUnique({
        where: { id },
      });
      if (!updated) {
        return { error: 'inquiry_not_found' as const };
      }

      let cycleStatusAfter: 'inquiry_resolved' | 'inquiry_pending' | null = null;

      // When result is resolved (changed or unchanged), transition cycle status
      if (result === 'changed' || result === 'unchanged') {
        const remainingUnresolvedCount = await tx.inquiryRecord.count({
          where: {
            org_id: ctx.orgId,
            cycle_id: existing.cycle_id,
            id: { not: id },
            OR: [{ result: null }, { result: 'pending' }],
          },
        });

        cycleStatusAfter = remainingUnresolvedCount === 0 ? 'inquiry_resolved' : 'inquiry_pending';

        await tx.medicationCycle.update({
          where: { id: existing.cycle_id },
          data: {
            overall_status: cycleStatusAfter,
          },
        });

        await tx.cycleTransitionLog.create({
          data: {
            org_id: ctx.orgId,
            cycle_id: existing.cycle_id,
            from_status: existing.cycle.overall_status,
            to_status: cycleStatusAfter,
            actor_id: ctx.userId,
            note: `inquiry_record_resolved:${id}`,
          },
        });

        await resolveOperationalTasks(tx, {
          orgId: ctx.orgId,
          dedupeKey: `inquiry-workbench:${id}`,
          status: 'completed',
        });

        await tx.communicationRequest.updateMany({
          where: {
            org_id: ctx.orgId,
            related_entity_type: 'inquiry_record',
            related_entity_id: id,
            status: {
              in: ['draft', 'sent', 'received', 'in_progress', 'responded', 'escalated'],
            },
          },
          data: {
            status: 'closed',
          },
        });

        if (existing.issue_id) {
          await tx.medicationIssue.update({
            where: { id: existing.issue_id },
            data: {
              status: 'resolved',
              resolved_by: ctx.userId,
              resolved_at: resolvedAt ?? new Date(),
            },
          });
        }
      } else if (result === 'pending' && existing.issue_id) {
        cycleStatusAfter = 'inquiry_pending';

        await tx.medicationCycle.update({
          where: { id: existing.cycle_id },
          data: { overall_status: cycleStatusAfter },
        });

        await tx.cycleTransitionLog.create({
          data: {
            org_id: ctx.orgId,
            cycle_id: existing.cycle_id,
            from_status: existing.cycle.overall_status,
            to_status: cycleStatusAfter,
            actor_id: ctx.userId,
            note: `inquiry_record_reopened:${id}`,
          },
        });

        await tx.medicationIssue.update({
          where: { id: existing.issue_id },
          data: {
            status: 'in_progress',
            resolved_by: null,
            resolved_at: null,
          },
        });
      }

      await createAuditLogEntry(tx, ctx, {
        action: 'inquiry_record_updated',
        targetType: 'inquiry_record',
        targetId: id,
        changes: {
          cycle_id: existing.cycle_id,
          line_id: existing.line_id,
          issue_id: existing.issue_id,
          result_before: existing.result,
          result_after: result ?? existing.result,
          change_detail_changed: change_detail !== undefined,
          proposal_origin: proposal_origin ?? null,
          residual_adjustment: residual_adjustment ?? null,
          line_update: lineUpdateAudit,
          cycle_status_before: existing.cycle.overall_status,
          cycle_status_after: cycleStatusAfter,
        },
      });

      return { inquiry: updated };
    },
    { requestContext: ctx, maxWaitMs: 10_000, timeoutMs: 20_000 },
  ).catch((error): InquiryPatchResult => {
    if (error instanceof InquiryPatchConflictError) {
      return { error: 'conflict', message: error.message };
    }
    throw error;
  });

  if ('error' in inquiryResult) {
    if (inquiryResult.error === 'conflict') {
      return conflict(
        inquiryResult.message ?? '疑義照会記録が他のユーザーによって更新されています',
      );
    }
    if (inquiryResult.error === 'inquiry_not_found')
      return notFound('疑義照会記録が見つかりません');
    if (inquiryResult.error === 'line_update_no_changes') {
      return validationError('処方明細の更新内容に変更がありません');
    }
    return validationError('指定された処方明細が見つかりません');
  }

  await notifyWorkflowMutation({
    orgId: ctx.orgId,
    payload: {
      source: 'inquiry_records_update',
      inquiry_id: id,
      cycle_id: existing.cycle_id,
      result: parsed.data.result ?? null,
      line_update_requested: parsed.data.line_update !== undefined,
      line_linked: existing.line_id !== null,
      issue_linked: existing.issue_id !== null,
    },
  });

  return success({ data: inquiryResult.inquiry });
}

export async function PATCH(req: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  try {
    return withSensitiveNoStore(await authenticatedPATCH(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    logger.error(
      {
        event: 'inquiry_record_patch_unhandled_error',
        route: ROUTE,
        method: req.method,
        status: 500,
      },
      err,
    );
    return withSensitiveNoStore(internalError());
  }
}
