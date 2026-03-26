import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { z } from 'zod';

const createSetAuditSchema = z.object({
  plan_id: z.string().min(1, 'セットプランIDは必須です'),
  result: z.enum(['approved', 'partial_approved', 'rejected'], {
    error: '鑑査結果を選択してください',
  }),
  approved_scope: z.record(z.string(), z.unknown()).optional(),
  reject_reason: z.string().optional(),
  audited_at: z.string().datetime().optional(),
});

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

    const audit = await tx.setAudit.create({
      data: {
        org_id: req.orgId,
        plan_id,
        result,
        approved_scope: approved_scope
          ? (approved_scope as import('@prisma/client').Prisma.InputJsonValue)
          : undefined,
        reject_reason: reject_reason ?? null,
        audited_by: req.userId,
        audited_at: now,
      },
    });

    if (result === 'approved') {
      // carry_items confirmed — advance cycle to set_audited
      await tx.medicationCycle.update({
        where: { id: plan.cycle_id },
        data: { overall_status: 'set_audited' },
      });
    } else if (result === 'partial_approved') {
      // Partial: carry_items_partial + re-work task
      await tx.medicationCycle.update({
        where: { id: plan.cycle_id },
        data: {
          overall_status: 'set_audited',
          exception_status: 'carry_items_partial',
        },
      });

      await tx.task.create({
        data: {
          org_id: req.orgId,
          title: 'セット再作業（部分承認）',
          description: `セット鑑査で部分承認となりました。承認範囲: ${
            approved_scope ? JSON.stringify(approved_scope) : '未指定'
          }`,
          status: 'pending',
          priority: 'high',
          related_entity_type: 'cycle',
          related_entity_id: plan.cycle_id,
        },
      });
    } else {
      // rejected — notify + WorkflowException + back to setting
      await tx.medicationCycle.update({
        where: { id: plan.cycle_id },
        data: { overall_status: 'setting' },
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

  return success({ data: auditResult }, 201);
}, {
  permission: 'canAuditSet',
  message: 'セット鑑査の実行権限がありません',
});
