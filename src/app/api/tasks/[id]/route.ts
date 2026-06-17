import { NextRequest } from 'next/server';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { updateTaskSchema } from '@/lib/validations/task';
import {
  buildDashboardTaskAssignmentWhere,
  resolveDashboardAssignmentScope,
} from '@/server/services/dashboard-assignment-scope';
import { requireWritablePatient } from '@/server/services/patient-write-guard';

async function requireWritableTaskPatient(
  ctx: Parameters<typeof requireWritablePatient>[1],
  task: { related_entity_type: string | null; related_entity_id: string | null },
) {
  if (task.related_entity_type === 'patient' && task.related_entity_id) {
    return requireWritablePatient(prisma, ctx, task.related_entity_id);
  }

  if (task.related_entity_type !== 'case' || !task.related_entity_id) return null;

  const careCase = await prisma.careCase.findFirst({
    where: {
      id: task.related_entity_id,
      org_id: ctx.orgId,
    },
    select: { patient_id: true },
  });
  if (!careCase) return null;

  return requireWritablePatient(prisma, ctx, careCase.patient_id);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '運用タスクの更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('タスクIDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = updateTaskSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const assignmentScope = await resolveDashboardAssignmentScope({
    db: prisma,
    orgId: ctx.orgId,
    accessContext: ctx,
  });
  const existing = await prisma.task.findFirst({
    where: {
      id,
      org_id: ctx.orgId,
      ...buildDashboardTaskAssignmentWhere(assignmentScope),
    },
  });
  if (!existing) return notFound('タスクが見つかりません');

  const writable = await requireWritableTaskPatient(ctx, existing);
  if (writable && 'response' in writable) return writable.response;

  if (
    assignmentScope.assignedToUserId &&
    parsed.data.assigned_to !== undefined &&
    parsed.data.assigned_to !== existing.assigned_to
  ) {
    return validationError('担当者の変更権限がありません');
  }

  const task = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      return tx.task.update({
        where: { id },
        data: {
          ...(parsed.data.status ? { status: parsed.data.status } : {}),
          ...(parsed.data.assigned_to !== undefined
            ? { assigned_to: parsed.data.assigned_to }
            : {}),
          ...(parsed.data.due_date !== undefined
            ? { due_date: parsed.data.due_date ? new Date(parsed.data.due_date) : null }
            : {}),
          completed_at:
            parsed.data.status === 'completed'
              ? new Date()
              : parsed.data.status
                ? null
                : existing.completed_at,
        },
      });
    },
    { requestContext: ctx },
  );

  return success({ data: task });
}
