import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, conflict } from '@/lib/api/response';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import { transitionCycleStatus, InvalidTransitionError, VersionConflictError } from '@/lib/db/cycle-transition';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';

// B3: approved_scope keys must match pattern day_number-slot
const approvedScopeSchema = z
  .record(z.string().regex(/^\d+-(?:morning|noon|evening|bedtime|prn)$/), z.boolean())
  .optional();

const createSetAuditSchema = z.object({
  plan_id: z.string().min(1, 'セットプランIDは必須です'),
  result: z.enum(['approved', 'partial_approved', 'rejected'], {
    error: '鑑査結果を選択してください',
  }),
  approved_scope: approvedScopeSchema,
  reject_reason: z.string().optional(),
  audited_at: z.string().datetime().optional(),
});

function normalizeApprovedScope(scope: unknown) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    return undefined;
  }

  const normalized = Object.fromEntries(
    Object.entries(scope).filter(([key, value]) => typeof key === 'string' && value === true)
  );

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function mergeApprovedScope(previousScope: unknown, currentScope?: Record<string, boolean>) {
  const previous = normalizeApprovedScope(previousScope) ?? {};
  const current = normalizeApprovedScope(currentScope) ?? {};
  const merged = { ...previous, ...current };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function buildSetCarryItems(
  batches: Array<{
    id: string;
    slot: string;
    day_number: number;
    quantity: number;
    carry_type: string;
    line: {
      id: string;
      drug_name: string;
      dose: string;
      frequency: string;
      unit: string | null;
    };
  }>,
  approvedScope?: Record<string, unknown>
) {
  const approvedKeys =
    approvedScope == null ? null : new Set(Object.keys(approvedScope).filter((key) => approvedScope[key] === true));

  return batches
    .filter((batch) => {
      if (!approvedKeys) return true;
      return approvedKeys.has(`${batch.day_number}-${batch.slot}`);
    })
    .map((batch) => ({
      batch_id: batch.id,
      line_id: batch.line.id,
      drug_name: batch.line.drug_name,
      dose: batch.line.dose,
      frequency: batch.line.frequency,
      day_number: batch.day_number,
      slot: batch.slot,
      quantity: batch.quantity,
      unit: batch.line.unit,
      carry_type: batch.carry_type,
    }));
}

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createSetAuditSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { plan_id, result, approved_scope, reject_reason, audited_at } =
    parsed.data;

  const auditResult = await withOrgContext(req.orgId, async (tx) => {
    const plan = await tx.setPlan.findFirst({
      where: { id: plan_id, org_id: req.orgId },
      select: { id: true, cycle_id: true },
    });

    if (!plan) return null;

    const now = audited_at ? new Date(audited_at) : new Date();
    const setBatches = await tx.setBatch.findMany({
      where: { plan_id, org_id: req.orgId },
      include: {
        line: {
          select: {
            id: true,
            drug_name: true,
            dose: true,
            frequency: true,
            unit: true,
          },
        },
      },
    });

    // B3: Zero-batch guard
    if (setBatches.length === 0) {
      return { error: 'no_batches' as const };
    }

    // B3: Validate approved_scope keys match actual batches
    if (approved_scope) {
      const validKeys = new Set(setBatches.map((b) => `${b.day_number}-${b.slot}`));
      const invalidKeys = Object.keys(approved_scope).filter((key) => !validKeys.has(key));
      if (invalidKeys.length > 0) {
        return { error: 'invalid_scope_keys' as const, keys: invalidKeys };
      }
    }

    const latestAudit =
      result === 'partial_approved'
        ? await tx.setAudit.findFirst({
            where: { plan_id, org_id: req.orgId },
            orderBy: [{ audited_at: 'desc' }, { created_at: 'desc' }],
            select: {
              result: true,
              approved_scope: true,
            },
          })
        : null;

    const effectiveApprovedScope =
      result === 'partial_approved'
        ? latestAudit?.result === 'partial_approved'
          ? mergeApprovedScope(latestAudit.approved_scope, approved_scope)
          : normalizeApprovedScope(approved_scope)
        : normalizeApprovedScope(approved_scope);

    if (result === 'partial_approved' && !effectiveApprovedScope) {
      return { error: 'missing_scope' as const };
    }

    const audit = await tx.setAudit.create({
      data: {
        org_id: req.orgId,
        plan_id,
        result,
        approved_scope: effectiveApprovedScope
          ? (effectiveApprovedScope as import('@prisma/client').Prisma.InputJsonValue)
          : undefined,
        reject_reason: reject_reason ?? null,
        audited_by: req.userId,
        audited_at: now,
      },
    });

    const transitionHelper = async (toStatus: string, options?: { exceptionStatus?: string | null }) => {
      try {
        await transitionCycleStatus(tx, plan.cycle_id, req.orgId, toStatus, req.userId, options);
      } catch (err) {
        if (err instanceof InvalidTransitionError) {
          return { error: `ステータス遷移が不正です: ${err.fromStatus} → ${err.toStatus}` } as const;
        }
        if (err instanceof VersionConflictError) {
          return { error: err.message, conflict: true } as const;
        }
        throw err;
      }
      return null;
    };

    if (result === 'approved') {
      // carry_items confirmed — advance cycle to set_audited
      const carryItems = buildSetCarryItems(setBatches);
      const transitionErr = await transitionHelper('set_audited');
      if (transitionErr) return transitionErr;
      await tx.visitSchedule.updateMany({
        where: {
          org_id: req.orgId,
          cycle_id: plan.cycle_id,
          schedule_status: {
            in: ['planned', 'in_preparation', 'ready', 'postponed'],
          },
        },
        data: {
          carry_items: carryItems as Prisma.InputJsonValue,
          carry_items_status: 'ready',
        },
      });

      // B4: Auto-resolve open set_audit_rejected exceptions on approval
      await tx.workflowException.updateMany({
        where: {
          cycle_id: plan.cycle_id,
          exception_type: 'set_audit_rejected',
          status: 'open',
        },
        data: { status: 'resolved', resolved_by: req.userId, resolved_at: new Date() },
      });
    } else if (result === 'partial_approved') {
      // Partial: carry_items_partial + re-work task
      const carryItems = buildSetCarryItems(
        setBatches,
        effectiveApprovedScope
      );
      const transitionErr = await transitionHelper('set_audited', { exceptionStatus: 'carry_items_partial' });
      if (transitionErr) return transitionErr;
      await tx.visitSchedule.updateMany({
        where: {
          org_id: req.orgId,
          cycle_id: plan.cycle_id,
          schedule_status: {
            in: ['planned', 'in_preparation', 'ready', 'postponed'],
          },
        },
        data: {
          carry_items: carryItems as Prisma.InputJsonValue,
          carry_items_status: 'partial',
        },
      });

      await tx.task.create({
        data: {
          org_id: req.orgId,
          title: 'セット再作業（部分承認）',
          description: `セット鑑査で部分承認となりました。承認範囲: ${
            effectiveApprovedScope ? JSON.stringify(effectiveApprovedScope) : '未指定'
          }`,
          status: 'pending',
          priority: 'high',
          related_entity_type: 'cycle',
          related_entity_id: plan.cycle_id,
        },
      });
    } else {
      // rejected — notify + WorkflowException + back to setting
      const transitionErr = await transitionHelper('setting');
      if (transitionErr) return transitionErr;
      await tx.visitSchedule.updateMany({
        where: {
          org_id: req.orgId,
          cycle_id: plan.cycle_id,
          schedule_status: {
            in: ['planned', 'in_preparation', 'ready', 'postponed'],
          },
        },
        data: {
          carry_items: [],
          carry_items_status: 'blocked',
        },
      });

      await tx.workflowException.create({
        data: {
          org_id: req.orgId,
          cycle_id: plan.cycle_id,
          exception_type: 'set_audit_rejected',
          description: `セット鑑査差戻し: ${reject_reason ?? '理由未記入'}`,
          severity: 'warning',
          status: 'open',
        },
      });
    }

    return audit;
  });

  if (!auditResult) return notFound('指定されたセットプランが見つかりません');
  if ('error' in auditResult) {
    if (auditResult.error === 'no_batches') {
      return validationError('セットバッチが存在しないプランは鑑査できません');
    }
    if (auditResult.error === 'missing_scope') {
      return validationError('部分承認時は承認済みスロットを1件以上指定してください');
    }
    if (auditResult.error === 'invalid_scope_keys') {
      return validationError('承認範囲のキーが実際のバッチと一致しません', {
        invalid_keys: 'keys' in auditResult ? auditResult.keys : [],
      });
    }
    if ('conflict' in auditResult && auditResult.conflict) return conflict(auditResult.error);
    return validationError(auditResult.error);
  }

  await notifyWorkflowMutation({
    orgId: req.orgId,
    eventType: 'cycle_transition',
    payload: { source: 'set_audits', plan_id },
  });

  return success({ data: auditResult }, 201);
}, {
  permission: 'canAuditSet',
  message: 'セット鑑査の実行権限がありません',
});
