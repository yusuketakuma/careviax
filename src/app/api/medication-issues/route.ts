import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { createMedicationIssueSchema } from '@/lib/validations/medication';
import { prisma } from '@/lib/db/client';

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const { cursor, limit } = parsePaginationParams(searchParams);

  const patientId = searchParams.get('patient_id') ?? undefined;
  const status = searchParams.get('status') ?? undefined;

  const where = {
    org_id: req.orgId,
    ...(patientId ? { patient_id: patientId } : {}),
    ...(status ? { status: status as 'open' | 'in_progress' | 'resolved' | 'dismissed' } : {}),
  };

  const issues = await prisma.medicationIssue.findMany({
    where,
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { identified_at: 'desc' },
    select: {
      id: true,
      org_id: true,
      patient_id: true,
      case_id: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      category: true,
      identified_by: true,
      identified_at: true,
      resolved_by: true,
      resolved_at: true,
      created_at: true,
      updated_at: true,
    },
  });

  const hasMore = issues.length > limit;
  const data = hasMore ? issues.slice(0, limit) : issues;
  const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

  return success({ data, hasMore, nextCursor });
}, {
  permission: 'canVisit',
  message: '服薬課題の閲覧権限がありません',
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createMedicationIssueSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const issue = await withOrgContext(req.orgId, async (tx) => {
    return tx.medicationIssue.create({
      data: {
        org_id: req.orgId,
        identified_by: req.userId,
        ...parsed.data,
      },
    });
  });

  return success({ data: issue }, 201);
}, {
  permission: 'canVisit',
  message: '服薬課題の作成権限がありません',
});
