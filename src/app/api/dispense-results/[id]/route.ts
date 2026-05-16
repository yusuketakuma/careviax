import { NextRequest } from 'next/server';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, conflict } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import {
  transitionCycleStatus,
  InvalidTransitionError,
  VersionConflictError,
} from '@/lib/db/cycle-transition';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import { buildMedicationCycleAssignmentWhere } from '@/server/services/prescription-access';
import { z } from 'zod';

const updateDispenseResultSchema = z.object({
  actual_drug_name: z.string().min(1).optional(),
  actual_drug_code: z.string().optional(),
  actual_quantity: z.number().positive().optional(),
  actual_unit: z.string().optional(),
  discrepancy_reason: z.string().optional(),
  carry_type: z.enum(['carry', 'facility_deposit', 'deferred']).optional(),
  special_notes: z.string().optional(),
  version: z.number().int().min(1).optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(async (authReq: AuthenticatedRequest) => {
    const { id } = await params;
    const cycleAssignmentWhere = buildMedicationCycleAssignmentWhere(authReq);

    const result = await prisma.dispenseResult.findFirst({
      where: {
        id,
        org_id: authReq.orgId,
        ...(cycleAssignmentWhere ? { task: { cycle: cycleAssignmentWhere } } : {}),
      },
      include: {
        line: true,
      },
    });

    if (!result) return notFound('指定された調剤実績が見つかりません');

    return success(result);
  })(req);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(async (authReq: AuthenticatedRequest) => {
    const { id } = await params;
    const cycleAssignmentWhere = buildMedicationCycleAssignmentWhere(authReq);

    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = updateDispenseResultSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const updated = await withOrgContext(authReq.orgId, async (tx) => {
      const existing = await tx.dispenseResult.findFirst({
        where: {
          id,
          org_id: authReq.orgId,
          ...(cycleAssignmentWhere ? { task: { cycle: cycleAssignmentWhere } } : {}),
        },
        select: {
          id: true,
          task_id: true,
          version: true,
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

      const result = await tx.dispenseResult.update({
        where: { id },
        data: {
          actual_drug_name: parsed.data.actual_drug_name,
          actual_drug_code: parsed.data.actual_drug_code,
          actual_quantity: parsed.data.actual_quantity,
          actual_unit: parsed.data.actual_unit,
          discrepancy_reason: parsed.data.discrepancy_reason,
          carry_type: parsed.data.carry_type,
          special_notes: parsed.data.special_notes,
        },
      });

      // Re-set DispenseTask status to completed and cycle to audit_pending
      const task = await tx.dispenseTask.update({
        where: { id: existing.task_id },
        data: { status: 'completed' },
        select: { cycle_id: true },
      });

      try {
        await transitionCycleStatus(
          tx,
          task.cycle_id,
          authReq.orgId,
          'audit_pending',
          authReq.userId,
        );
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

      return result;
    });

    if (!updated) return notFound('指定された調剤実績が見つかりません');
    if ('error' in updated) {
      if ('conflict' in updated && updated.conflict) return conflict(updated.error);
      return validationError(updated.error);
    }

    await notifyWorkflowMutation({
      orgId: authReq.orgId,
      eventType: 'cycle_transition',
      payload: { source: 'dispense_results_rework', result_id: id },
    });

    return success(updated);
  })(req);
}
