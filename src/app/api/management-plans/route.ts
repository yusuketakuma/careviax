import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { createManagementPlanSchema } from '@/lib/validations/management-plan';

export async function GET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '管理計画書の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { searchParams } = new URL(req.url);
  const caseId = searchParams.get('case_id') ?? undefined;

  const plans = await prisma.managementPlan.findMany({
    where: {
      org_id: ctx.orgId,
      ...(caseId ? { case_id: caseId } : {}),
    },
    orderBy: [{ updated_at: 'desc' }],
  });

  return success({ data: plans });
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '管理計画書の作成権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createManagementPlanSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const careCase = await prisma.careCase.findFirst({
    where: {
      id: parsed.data.case_id,
      org_id: ctx.orgId,
    },
    select: {
      id: true,
    },
  });
  if (!careCase) return notFound('ケースが見つかりません');

  const plan = await withOrgContext(ctx.orgId, async (tx) => {
    const latest = await tx.managementPlan.findFirst({
      where: {
        org_id: ctx.orgId,
        case_id: parsed.data.case_id,
      },
      orderBy: [{ version: 'desc' }],
      select: { version: true },
    });

    return tx.managementPlan.create({
      data: {
        org_id: ctx.orgId,
        case_id: parsed.data.case_id,
        title: parsed.data.title,
        summary: parsed.data.summary ?? null,
        content: parsed.data.content as Prisma.InputJsonValue,
        created_by: ctx.userId,
        version: (latest?.version ?? 0) + 1,
        effective_from: parsed.data.effective_from
          ? new Date(parsed.data.effective_from)
          : null,
        next_review_date: parsed.data.next_review_date
          ? new Date(parsed.data.next_review_date)
          : null,
        source_plan_id: parsed.data.source_plan_id ?? null,
      },
    });
  });

  return success({ data: plan }, 201);
}
