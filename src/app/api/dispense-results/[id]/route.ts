import { NextRequest } from 'next/server';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';

const updateDispenseResultSchema = z.object({
  actual_drug_name: z.string().min(1).optional(),
  actual_drug_code: z.string().optional(),
  actual_quantity: z.number().positive().optional(),
  actual_unit: z.string().optional(),
  discrepancy_reason: z.string().optional(),
  carry_type: z.enum(['carry', 'facility_deposit', 'deferred']).optional(),
  special_notes: z.string().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (authReq: AuthenticatedRequest) => {
    const { id } = await params;

    const result = await prisma.dispenseResult.findFirst({
      where: { id, org_id: authReq.orgId },
      include: {
        line: true,
      },
    });

    if (!result) return notFound('指定された調剤実績が見つかりません');

    return success(result);
  })(req);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(async (authReq: AuthenticatedRequest) => {
    const { id } = await params;

    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = updateDispenseResultSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const updated = await withOrgContext(authReq.orgId, async (tx) => {
      const existing = await tx.dispenseResult.findFirst({
        where: { id, org_id: authReq.orgId },
      });
      if (!existing) return null;

      // Precondition: the corresponding DispenseTask must have a rejected audit
      const hasRejection = await tx.dispenseAudit.findFirst({
        where: { task_id: existing.task_id, result: 'rejected' },
      });
      if (!hasRejection) {
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

      await tx.medicationCycle.update({
        where: { id: task.cycle_id },
        data: { overall_status: 'audit_pending' },
      });

      return result;
    });

    if (!updated) return notFound('指定された調剤実績が見つかりません');
    if ('error' in updated) return validationError(updated.error);

    return success(updated);
  })(req);
}
