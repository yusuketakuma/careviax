import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { toPrismaJsonInput } from '@/lib/db/json';
import { isPrismaUniqueConstraintError } from '@/lib/db/prisma-errors';
import { withOrgContext } from '@/lib/db/rls';
import { conflict, internalError, notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { buildCareCaseAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { createManagementPlanSchema } from '@/lib/validations/management-plan';

type OptionalTrimmedSearchParamResult = { value: string | undefined } | { error: string };

function readOptionalTrimmedSearchParam(value: string | null): OptionalTrimmedSearchParamResult {
  if (value === null) return { value: undefined };
  const trimmed = value.trim();
  if (!trimmed) return { error: 'case_id は空にできません' };
  return { value: trimmed };
}

function findInvalidManagementPlanListQueryParams(searchParams: URLSearchParams) {
  if (searchParams.getAll('case_id').length <= 1) return null;
  return { case_id: ['case_id は1つだけ指定してください'] };
}

async function authenticatedGET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '管理計画書の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { searchParams } = new URL(req.url);
  const invalidQueryParams = findInvalidManagementPlanListQueryParams(searchParams);
  if (invalidQueryParams) {
    return validationError('クエリパラメータが不正です', invalidQueryParams);
  }

  const caseIdResult = readOptionalTrimmedSearchParam(searchParams.get('case_id'));
  if ('error' in caseIdResult) return validationError(caseIdResult.error);
  const caseId = caseIdResult.value;
  const assignmentWhere = buildCareCaseAssignmentWhere(ctx);

  const plans = await withOrgContext(
    ctx.orgId,
    (tx) =>
      tx.managementPlan.findMany({
        where: {
          org_id: ctx.orgId,
          ...(caseId ? { case_id: caseId } : {}),
          ...(assignmentWhere ? { case_: assignmentWhere } : {}),
        },
        orderBy: [{ updated_at: 'desc' }],
      }),
    { requestContext: ctx },
  );

  return success({ data: plans });
}

export async function GET(req: NextRequest) {
  try {
    return withSensitiveNoStore(await authenticatedGET(req));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '管理計画書の作成権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = createManagementPlanSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const assignmentWhere = buildCareCaseAssignmentWhere(ctx);
  const careCase = await prisma.careCase.findFirst({
    where: {
      id: parsed.data.case_id,
      org_id: ctx.orgId,
      ...(assignmentWhere ?? {}),
    },
    select: {
      id: true,
    },
  });
  if (!careCase) return notFound('ケースが見つかりません');

  if (parsed.data.source_plan_id) {
    const sourcePlan = await prisma.managementPlan.findFirst({
      where: {
        id: parsed.data.source_plan_id,
        org_id: ctx.orgId,
        case_id: parsed.data.case_id,
        ...(assignmentWhere ? { case_: assignmentWhere } : {}),
      },
      select: { id: true },
    });
    if (!sourcePlan) return notFound('複製元の管理計画書が見つかりません');
  }

  const plan = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const latest = await tx.managementPlan.findFirst({
        where: {
          org_id: ctx.orgId,
          case_id: parsed.data.case_id,
        },
        orderBy: [{ version: 'desc' }],
        select: { version: true },
      });

      try {
        return await tx.managementPlan.create({
          data: {
            org_id: ctx.orgId,
            case_id: parsed.data.case_id,
            title: parsed.data.title,
            summary: parsed.data.summary ?? null,
            content: toPrismaJsonInput(parsed.data.content),
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
      } catch (error) {
        if (isPrismaUniqueConstraintError(error)) {
          return {
            conflict: true as const,
            message:
              '同じケースで同じバージョンの管理計画書が既に作成されています。最新のデータを取得してください。',
          };
        }
        throw error;
      }
    },
    { requestContext: ctx },
  );

  if ('conflict' in plan) return conflict(plan.message);

  return success({ data: plan }, 201);
}
