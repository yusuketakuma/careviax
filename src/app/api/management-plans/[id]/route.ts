import { NextRequest } from 'next/server';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { toPrismaJsonInput } from '@/lib/db/json';
import { formatDateKey } from '@/lib/date-key';
import { withOrgContext } from '@/lib/db/rls';
import { conflict, internalError, notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { buildCareCaseAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import {
  isManagementPlanDateRangeValid,
  updateManagementPlanSchema,
} from '@/lib/validations/management-plan';
import {
  resolveManagementPlanReviewAlert,
  scheduleManagementPlanReviewAlert,
} from '@/server/services/management-plans';

const MANAGEMENT_PLAN_CONFLICT_MESSAGE =
  '管理計画書が他のユーザーによって更新されています。最新のデータを取得してください。';

class ManagementPlanMutationConflictError extends Error {}

function dateOnlyString(value: Date | string | null | undefined) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return formatDateKey(value);
}

async function authenticatedGET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '管理計画書の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('管理計画書IDが不正です');

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

export async function GET(req: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch {
    return withSensitiveNoStore(internalError());
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '管理計画書の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('管理計画書IDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = updateManagementPlanSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

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

    const effectiveFrom =
      data.effective_from !== undefined
        ? data.effective_from
        : dateOnlyString(existing.effective_from);
    const nextReviewDate =
      data.next_review_date !== undefined
        ? data.next_review_date
        : dateOnlyString(existing.next_review_date);
    if (!isManagementPlanDateRangeValid({ effectiveFrom, nextReviewDate })) {
      return validationError('入力値が不正です', {
        next_review_date: ['next_review_date は effective_from 以降の日付を指定してください'],
      });
    }

    const updateData = {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.summary !== undefined ? { summary: data.summary ?? null } : {}),
      ...(data.content !== undefined ? { content: toPrismaJsonInput(data.content) } : {}),
      ...(data.effective_from !== undefined
        ? {
            effective_from: data.effective_from ? new Date(data.effective_from) : null,
          }
        : {}),
      ...(data.next_review_date !== undefined
        ? {
            next_review_date: data.next_review_date ? new Date(data.next_review_date) : null,
          }
        : {}),
    };

    const updated = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const freshPlan = await tx.managementPlan.findFirst({
          where: {
            id,
            org_id: ctx.orgId,
            status: 'draft',
            ...(assignmentWhere ? { case_: assignmentWhere } : {}),
          },
        });
        if (!freshPlan) throw new ManagementPlanMutationConflictError();

        const updateResult = await tx.managementPlan.updateMany({
          where: {
            id,
            org_id: ctx.orgId,
            status: 'draft',
            ...(assignmentWhere ? { case_: assignmentWhere } : {}),
          },
          data: updateData,
        });
        if (updateResult.count !== 1) throw new ManagementPlanMutationConflictError();

        const updatedPlan = await tx.managementPlan.findUnique({ where: { id } });
        if (!updatedPlan) throw new ManagementPlanMutationConflictError();
        return updatedPlan;
      },
      { requestContext: ctx },
    ).catch((error) => {
      if (error instanceof ManagementPlanMutationConflictError) {
        return { error: 'conflict' as const };
      }
      throw error;
    });

    if ('error' in updated) return conflict(MANAGEMENT_PLAN_CONFLICT_MESSAGE);

    return success({ data: updated });
  }

  if (parsed.data.action === 'archive') {
    const archived = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const updateResult = await tx.managementPlan.updateMany({
          where: {
            id,
            org_id: ctx.orgId,
            ...(assignmentWhere ? { case_: assignmentWhere } : {}),
          },
          data: {
            status: 'archived',
          },
        });
        if (updateResult.count !== 1) throw new ManagementPlanMutationConflictError();

        await resolveManagementPlanReviewAlert(tx, {
          orgId: ctx.orgId,
          planId: existing.id,
        });

        const archivedPlan = await tx.managementPlan.findUnique({ where: { id } });
        if (!archivedPlan) throw new ManagementPlanMutationConflictError();
        return archivedPlan;
      },
      { requestContext: ctx },
    ).catch((error) => {
      if (error instanceof ManagementPlanMutationConflictError) {
        return { error: 'conflict' as const };
      }
      throw error;
    });

    if ('error' in archived) return conflict(MANAGEMENT_PLAN_CONFLICT_MESSAGE);

    return success({ data: archived });
  }

  if (existing.status === 'approved') {
    return success({ data: existing });
  }
  if (existing.status !== 'draft') {
    return validationError('この計画書は承認できません');
  }

  const approved = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const freshPlan = await tx.managementPlan.findFirst({
        where: {
          id,
          org_id: ctx.orgId,
          status: 'draft',
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
      if (!freshPlan) throw new ManagementPlanMutationConflictError();

      const approveResult = await tx.managementPlan.updateMany({
        where: {
          id: freshPlan.id,
          org_id: ctx.orgId,
          status: 'draft',
          ...(assignmentWhere ? { case_: assignmentWhere } : {}),
        },
        data: {
          status: 'approved',
          approved_by: ctx.userId,
          approved_at: new Date(),
          reviewed_by: ctx.userId,
          reviewed_at: new Date(),
        },
      });
      if (approveResult.count !== 1) throw new ManagementPlanMutationConflictError();

      await tx.managementPlan.updateMany({
        where: {
          org_id: ctx.orgId,
          case_id: freshPlan.case_id,
          status: 'approved',
          id: { not: freshPlan.id },
        },
        data: {
          status: 'superseded',
        },
      });

      const updated = await tx.managementPlan.findUnique({ where: { id: freshPlan.id } });
      if (!updated) throw new ManagementPlanMutationConflictError();

      if (updated.next_review_date) {
        await scheduleManagementPlanReviewAlert(tx, {
          orgId: ctx.orgId,
          planId: updated.id,
          caseId: updated.case_id,
          patientId: freshPlan.case_.patient_id,
          dueDate: updated.next_review_date,
          assignedTo: freshPlan.case_.primary_pharmacist_id ?? null,
        });
      } else {
        await resolveManagementPlanReviewAlert(tx, {
          orgId: ctx.orgId,
          planId: updated.id,
        });
      }

      return updated;
    },
    { requestContext: ctx },
  ).catch((error) => {
    if (error instanceof ManagementPlanMutationConflictError) {
      return { error: 'conflict' as const };
    }
    throw error;
  });

  if ('error' in approved) return conflict(MANAGEMENT_PLAN_CONFLICT_MESSAGE);

  return success({ data: approved });
}
