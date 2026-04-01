import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { createInterventionSchema } from '@/lib/validations/intervention';
import { prisma } from '@/lib/db/client';

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const { cursor, limit } = parsePaginationParams(searchParams);

  const patientId = searchParams.get('patient_id') ?? undefined;
  const issueId = searchParams.get('issue_id') ?? undefined;

  const where = {
    org_id: req.orgId,
    ...(patientId ? { patient_id: patientId } : {}),
    ...(issueId ? { issue_id: issueId } : {}),
  };

  const interventions = await prisma.intervention.findMany({
    where,
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { performed_at: 'desc' },
    select: {
      id: true,
      org_id: true,
      patient_id: true,
      issue_id: true,
      type: true,
      description: true,
      outcome: true,
      performed_by: true,
      performed_at: true,
      created_at: true,
      updated_at: true,
    },
  });

  const hasMore = interventions.length > limit;
  const data = hasMore ? interventions.slice(0, limit) : interventions;
  const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

  return success({ data, hasMore, nextCursor });
}, {
  permission: 'canVisit',
  message: '介入記録の閲覧権限がありません',
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createInterventionSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const intervention = await withOrgContext(req.orgId, async (tx) => {
    return tx.intervention.create({
      data: {
        org_id: req.orgId,
        performed_by: req.userId,
        ...parsed.data,
        performed_at: new Date(parsed.data.performed_at),
      },
    });
  });

  return success({ data: intervention }, 201);
}, {
  permission: 'canVisit',
  message: '介入記録の作成権限がありません',
});
