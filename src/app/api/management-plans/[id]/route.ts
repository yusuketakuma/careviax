import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { buildCareCaseAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { updateManagementPlanSchema } from '@/lib/validations/management-plan';
import {
  resolveManagementPlanReviewAlert,
  scheduleManagementPlanReviewAlert,
} from '@/server/services/management-plans';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '管理計画書の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { id } = await params;
  const assignmentWhere = buildCareCaseAssignmentWhere(ctx);
  const plan = await prisma.managementPlan.findFirst({
    where: {
      id,
      org_id: ctx.orgId,
      ...(assignmentWhere ? { case_: assignmentWhere } : {}),
    },
  });

  if (!plan) return notFound('管理計画書が見つかりません');
  return success({ data: plan });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '管理計画書の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = updateManagementPlanSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { id } = await params;
  const assignmentWhere = buildCareCaseAssignmentWhere(ctx);
  const existing = await prisma.managementPlan.findFirst({
    where: {
      id,
      org_id: ctx.orgId,
      ...(assignmentWhere ? { case_: assignmentWhere } : {}),
    },
    include: {
      case_: {
        select: {
          patient_id: true,
          primary_pharmacist_id: true,
        },
      },
    },
  });
  if (!existing) return notFound('管理計画書が見つかりません');

  if (parsed.data.action === 'update') {
    const data = parsed.data;
    if (existing.status !== 'draft') {
      return validationError('承認済みまたはアーカイブ済みの計画書は更新できません');
    }

    const updated = await withOrgContext(ctx.orgId, async (tx) => {
      return tx.managementPlan.update({
        where: { id },
        data: {
          ...(data.title !== undefined ? { title: data.title } : {}),
          ...(data.summary !== undefined ? { summary: data.summary ?? null } : {}),
          ...(data.content !== undefined
            ? { content: toPrismaJsonInput(data.content) }
            : {}),
          ...(data.effective_from !== undefined
            ? {
                effective_from: data.effective_from
                  ? new Date(data.effective_from)
                  : null,
              }
            : {}),
          ...(data.next_review_date !== undefined
            ? {
                next_review_date: data.next_review_date
                  ? new Date(data.next_review_date)
                  : null,
              }
            : {}),
        },
      });
    }, { requestContext: ctx });

    return success({ data: updated });
  }

  if (parsed.data.action === 'archive') {
    const archived = await withOrgContext(ctx.orgId, async (tx) => {
      await resolveManagementPlanReviewAlert(tx, {
        orgId: ctx.orgId,
        planId: existing.id,
      });

      return tx.managementPlan.update({
        where: { id },
        data: {
          status: 'archived',
        },
      });
    }, { requestContext: ctx });

    return success({ data: archived });
  }

  if (existing.status === 'approved') {
    return success({ data: existing });
  }
  if (existing.status !== 'draft') {
    return validationError('この計画書は承認できません');
  }

  const approved = await withOrgContext(ctx.orgId, async (tx) => {
    await tx.managementPlan.updateMany({
      where: {
        org_id: ctx.orgId,
        case_id: existing.case_id,
        status: 'approved',
        id: { not: existing.id },
      },
      data: {
        status: 'superseded',
      },
    });

    const updated = await tx.managementPlan.update({
      where: { id: existing.id },
      data: {
        status: 'approved',
        approved_by: ctx.userId,
        approved_at: new Date(),
        reviewed_by: ctx.userId,
        reviewed_at: new Date(),
      },
    });

    if (updated.next_review_date) {
      await scheduleManagementPlanReviewAlert(tx, {
        orgId: ctx.orgId,
        planId: updated.id,
        caseId: updated.case_id,
        patientId: existing.case_.patient_id,
        dueDate: updated.next_review_date,
        assignedTo: existing.case_.primary_pharmacist_id ?? null,
      });
    } else {
      await resolveManagementPlanReviewAlert(tx, {
        orgId: ctx.orgId,
        planId: updated.id,
      });
    }

    return updated;
  }, { requestContext: ctx });

  return success({ data: approved });
}
