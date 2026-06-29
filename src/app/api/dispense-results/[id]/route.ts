import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { requireAuthContext } from '@/lib/auth/context';
import { hasPermission } from '@/lib/auth/permissions';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import {
  success,
  validationError,
  notFound,
  conflict,
  internalError,
  forbidden,
} from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import {
  transitionCycleStatus,
  InvalidTransitionError,
  VersionConflictError,
} from '@/lib/db/cycle-transition';
import {
  buildActualQuantityConfirmationErrors,
  buildActualQuantityUnitErrors,
  buildDiscrepancyReasonErrors,
  buildUnresolvedPrescribedQuantityErrors,
  resolveCanonicalActualUnit,
  type DispenseResultValidationLine,
  type PrescribedDispenseLine,
} from '@/lib/dispensing/dispense-result-validation';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import { buildMedicationCycleAssignmentWhere } from '@/server/services/prescription-access';
import { z } from 'zod';

const updateDispenseResultSchema = z.object({
  actual_drug_name: z.string().min(1).optional(),
  actual_drug_code: z.string().optional(),
  actual_quantity: z.number().positive().optional(),
  actual_quantity_confirmed: z.boolean().optional(),
  actual_quantity_source: z
    .enum(['existing_result', 'prescription_quantity_confirmed', 'manual_entry'])
    .optional(),
  actual_unit: z.string().optional(),
  discrepancy_reason: z.string().optional(),
  carry_type: z.enum(['carry', 'facility_deposit', 'deferred']).optional(),
  special_notes: z.string().optional(),
  version: z.number().int().min(1).optional(),
});

function resolveCarryItemsStatus(lines: Array<{ carry_type: string | null | undefined }>) {
  const hasDeferred = lines.some((line) => line.carry_type === 'deferred');
  const hasReadyItem = lines.some(
    (line) => line.carry_type === 'carry' || line.carry_type === 'facility_deposit',
  );

  if (!hasDeferred) return 'ready' as const;
  if (hasReadyItem) return 'partial' as const;
  return 'blocked' as const;
}

function normalizeOptionalText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function touchesDispenseResultSafetyFields(data: z.infer<typeof updateDispenseResultSchema>) {
  return (
    data.actual_drug_name !== undefined ||
    data.actual_drug_code !== undefined ||
    data.actual_quantity !== undefined ||
    data.actual_unit !== undefined ||
    data.discrepancy_reason !== undefined ||
    data.carry_type !== undefined
  );
}

async function authenticatedGET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req);
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;
  if (
    !hasPermission(ctx.role, 'canDispense') &&
    !hasPermission(ctx.role, 'canAuditDispense') &&
    !hasPermission(ctx.role, 'canReport')
  ) {
    return forbidden('調剤実績の閲覧権限がありません');
  }

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('調剤実績IDが不正です');

  const cycleAssignmentWhere = buildMedicationCycleAssignmentWhere(ctx);

  const result = await prisma.dispenseResult.findFirst({
    where: {
      id,
      org_id: ctx.orgId,
      ...(cycleAssignmentWhere ? { task: { cycle: cycleAssignmentWhere } } : {}),
    },
    include: {
      line: true,
    },
  });

  if (!result) return notFound('指定された調剤実績が見つかりません');

  return success(result);
}

export async function GET(req: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canDispense',
    message: '調剤実績の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('調剤実績IDが不正です');

  const cycleAssignmentWhere = buildMedicationCycleAssignmentWhere(ctx);

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = updateDispenseResultSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const updated = await withOrgContext(ctx.orgId, async (tx) => {
    const existing = await tx.dispenseResult.findFirst({
      where: {
        id,
        org_id: ctx.orgId,
        ...(cycleAssignmentWhere ? { task: { cycle: cycleAssignmentWhere } } : {}),
      },
      select: {
        id: true,
        task_id: true,
        line_id: true,
        actual_drug_name: true,
        actual_drug_code: true,
        actual_quantity: true,
        actual_unit: true,
        discrepancy_reason: true,
        carry_type: true,
        version: true,
        line: {
          select: {
            id: true,
            drug_name: true,
            drug_code: true,
            quantity: true,
            unit: true,
          },
        },
      },
    });
    if (!existing) return null;

    // B2: Version lock — reject if client version is stale
    if (parsed.data.version !== undefined && existing.version !== parsed.data.version) {
      return { error: '他のユーザーによって更新されています', conflict: true } as const;
    }

    // B5: Precondition — the LATEST audit for this task must be 'rejected'
    const latestAudit = await tx.dispenseAudit.findFirst({
      where: { task_id: existing.task_id },
      orderBy: { audited_at: 'desc' },
      select: { result: true },
    });
    if (latestAudit?.result !== 'rejected') {
      return { error: '差戻しされていないタスクの結果は修正できません' } as const;
    }

    const shouldValidateSafetyFields = touchesDispenseResultSafetyFields(parsed.data);
    const shouldValidateQuantityConfirmation = shouldValidateSafetyFields;
    const prescribedLine: PrescribedDispenseLine = {
      id: existing.line.id,
      drug_name: existing.line.drug_name,
      drug_code: existing.line.drug_code,
      quantity: existing.line.quantity,
      unit: existing.line.unit,
    };
    const effectiveLine: DispenseResultValidationLine = {
      line_id: existing.line_id,
      actual_drug_name: parsed.data.actual_drug_name ?? existing.actual_drug_name,
      actual_drug_code: parsed.data.actual_drug_code ?? existing.actual_drug_code,
      actual_quantity: parsed.data.actual_quantity ?? existing.actual_quantity,
      actual_quantity_confirmed: parsed.data.actual_quantity_confirmed,
      actual_quantity_source: parsed.data.actual_quantity_source,
      actual_unit: parsed.data.actual_unit ?? existing.actual_unit,
      discrepancy_reason: parsed.data.discrepancy_reason ?? existing.discrepancy_reason,
      carry_type: (parsed.data.carry_type ??
        existing.carry_type) as DispenseResultValidationLine['carry_type'],
    };

    if (shouldValidateSafetyFields) {
      const discrepancyReasonErrors = buildDiscrepancyReasonErrors({
        submittedLines: [effectiveLine],
        prescribedLines: [prescribedLine],
      });
      if (discrepancyReasonErrors.length > 0) {
        return {
          error: 'reason_required' as const,
          reasons: discrepancyReasonErrors,
        };
      }

      const unresolvedQuantityLines = buildUnresolvedPrescribedQuantityErrors({
        submittedLines: [effectiveLine],
        prescribedLines: [prescribedLine],
      });
      if (unresolvedQuantityLines.length > 0) {
        return {
          error: 'prescribed_quantity_required' as const,
          reasons: unresolvedQuantityLines,
        };
      }

      const invalidQuantityUnitLines = buildActualQuantityUnitErrors({
        submittedLines: [effectiveLine],
        prescribedLines: [prescribedLine],
      });
      if (invalidQuantityUnitLines.length > 0) {
        return {
          error: 'actual_quantity_unit_step_invalid' as const,
          reasons: invalidQuantityUnitLines,
        };
      }
    }

    if (shouldValidateQuantityConfirmation) {
      const actualQuantityConfirmationErrors = buildActualQuantityConfirmationErrors({
        submittedLines: [effectiveLine],
        prescribedLines: [prescribedLine],
        existingResults: [
          {
            line_id: existing.line_id,
            actual_quantity: existing.actual_quantity,
          },
        ],
      });
      if (actualQuantityConfirmationErrors.length > 0) {
        return {
          error: 'actual_quantity_confirmation_required' as const,
          reasons: actualQuantityConfirmationErrors,
        };
      }
    }

    const shouldUpdateActualUnit =
      parsed.data.actual_quantity !== undefined || parsed.data.actual_unit !== undefined;
    const canonicalActualUnit = shouldUpdateActualUnit
      ? resolveCanonicalActualUnit({
          prescribedUnit: prescribedLine.unit,
          actualUnit: effectiveLine.actual_unit,
        })
      : undefined;

    const result = await tx.dispenseResult.update({
      where: { id },
      data: {
        actual_drug_name: parsed.data.actual_drug_name,
        actual_drug_code: parsed.data.actual_drug_code,
        actual_quantity: parsed.data.actual_quantity,
        actual_unit: canonicalActualUnit,
        discrepancy_reason: parsed.data.discrepancy_reason,
        carry_type: parsed.data.carry_type,
        special_notes: parsed.data.special_notes,
        version: { increment: 1 },
      },
    });

    // Re-set DispenseTask status to completed and cycle to audit_pending
    const task = await tx.dispenseTask.update({
      where: { id: existing.task_id },
      data: { status: 'completed' },
      select: { cycle_id: true },
    });

    try {
      await transitionCycleStatus(tx, task.cycle_id, ctx.orgId, 'audit_pending', ctx.userId);
    } catch (err) {
      if (err instanceof InvalidTransitionError) {
        return {
          error: `ステータス遷移が不正です: ${err.fromStatus} → ${err.toStatus}`,
        } as const;
      }
      if (err instanceof VersionConflictError) {
        return { error: err.message, conflict: true } as const;
      }
      throw err;
    }

    const visitSchedules = await tx.visitSchedule.findMany({
      where: {
        org_id: ctx.orgId,
        cycle_id: task.cycle_id,
        schedule_status: { in: ['planned', 'in_preparation', 'ready'] },
      },
      select: { id: true, schedule_status: true },
    });

    if (visitSchedules.length > 0) {
      const persistedResults = await tx.dispenseResult.findMany({
        where: {
          org_id: ctx.orgId,
          task_id: existing.task_id,
        },
        select: {
          line_id: true,
          actual_drug_name: true,
          actual_drug_code: true,
          actual_quantity: true,
          actual_unit: true,
          carry_type: true,
          special_notes: true,
          line: {
            select: {
              drug_name: true,
              drug_code: true,
            },
          },
        },
      });
      const carryItemsStatus = resolveCarryItemsStatus(persistedResults);
      const carryItems = persistedResults.map((line) => ({
        line_id: line.line_id,
        drug_name: line.actual_drug_name || line.line?.drug_name || '',
        drug_code: normalizeOptionalText(line.actual_drug_code) ?? line.line?.drug_code ?? null,
        quantity: line.actual_quantity,
        unit: line.actual_unit,
        carry_type: line.carry_type,
        special_notes: line.special_notes,
      }));
      const readyScheduleIdsToReopen = visitSchedules
        .filter((visitSchedule) => visitSchedule.schedule_status === 'ready')
        .map((visitSchedule) => visitSchedule.id);

      if (readyScheduleIdsToReopen.length > 0) {
        await tx.visitPreparation.updateMany({
          where: {
            org_id: ctx.orgId,
            schedule_id: { in: readyScheduleIdsToReopen },
          },
          data: {
            carry_items_confirmed: false,
            prepared_at: null,
          },
        });
      }

      for (const visitSchedule of visitSchedules) {
        const shouldReopenReadySchedule = visitSchedule.schedule_status === 'ready';

        await tx.visitSchedule.update({
          where: { id: visitSchedule.id },
          data: {
            carry_items: carryItems,
            carry_items_status: carryItemsStatus,
            ...(shouldReopenReadySchedule
              ? {
                  schedule_status: 'in_preparation',
                  pre_visit_checklist_completed: false,
                }
              : {}),
          },
        });
      }
    }

    return result;
  });

  if (!updated) return notFound('指定された調剤実績が見つかりません');
  if ('error' in updated) {
    if ('conflict' in updated && updated.conflict) return conflict(updated.error);
    if (updated.error === 'reason_required') {
      return validationError('差異/欠品/代替がある明細は理由コードを入力してください', {
        discrepancy_lines: updated.reasons,
      });
    }
    if (updated.error === 'prescribed_quantity_required') {
      return validationError(
        '処方数量が未確定の明細があります。処方取込で数量を確認してから調剤完了してください',
        {
          unresolved_quantity_lines: updated.reasons,
        },
      );
    }
    if (updated.error === 'actual_quantity_confirmation_required') {
      return validationError(
        '調剤実数量の確認元が未確定の明細があります。数量確認後に調剤完了してください',
        {
          actual_quantity_confirmation_lines: updated.reasons,
        },
      );
    }
    if (updated.error === 'actual_quantity_unit_step_invalid') {
      return validationError('実数量が単位に合う刻みではありません', {
        actual_quantity_unit_lines: updated.reasons,
      });
    }
    return validationError(updated.error);
  }

  await notifyWorkflowMutation({
    orgId: ctx.orgId,
    eventType: 'cycle_transition',
    payload: { source: 'dispense_results_rework', result_id: id },
  });

  return success(updated);
}
