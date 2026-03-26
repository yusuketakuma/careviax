import { NextRequest } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { resolveWorkflowExceptionSchema } from '@/lib/validations/medication';
import { prisma } from '@/lib/db/client';

export const GET = withAuthContext(
  async (
    req: NextRequest,
    ctx,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    const { id } = await params;

    const exception = await prisma.workflowException.findFirst({
      where: { id, org_id: ctx.orgId },
    });
    if (!exception) return notFound('ワークフロー例外が見つかりません');

    return success(exception);
  },
  {
    permission: 'canDispense',
    message: 'ワークフロー例外の閲覧権限がありません',
  }
);

export const PATCH = withAuthContext(
  async (
    req: NextRequest,
    ctx,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    const { id } = await params;

    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = resolveWorkflowExceptionSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const existing = await prisma.workflowException.findFirst({
      where: { id, org_id: ctx.orgId },
      select: { id: true, cycle_id: true, status: true },
    });
    if (!existing) return notFound('ワークフロー例外が見つかりません');

    if (existing.status !== 'open') {
      return validationError('この例外は既に解決済みまたは却下済みです');
    }

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const updated = await tx.workflowException.update({
        where: { id },
        data: {
          status: parsed.data.status,
          resolved_by: ctx.userId,
          resolved_at: new Date(),
        },
      });

      // Clear exception_status on the associated cycle if all open exceptions are resolved
      if (existing.cycle_id) {
        const remainingOpen = await tx.workflowException.count({
          where: {
            cycle_id: existing.cycle_id,
            org_id: ctx.orgId,
            status: 'open',
            id: { not: id },
          },
        });

        if (remainingOpen === 0) {
          await tx.medicationCycle.update({
            where: { id: existing.cycle_id },
            data: { exception_status: null },
          });
        }
      }

      return updated;
    });

    return success(result);
  },
  {
    permission: 'canDispense',
    message: 'ワークフロー例外の解決権限がありません',
  }
);
