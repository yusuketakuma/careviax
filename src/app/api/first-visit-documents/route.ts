import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { createFirstVisitDocumentSchema } from '@/lib/validations/first-visit-document';
import { prisma } from '@/lib/db/client';

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const { cursor, limit } = parsePaginationParams(searchParams);

  const patientId = searchParams.get('patient_id') ?? undefined;
  const caseId = searchParams.get('case_id') ?? undefined;

  const where = {
    org_id: req.orgId,
    ...(patientId ? { patient_id: patientId } : {}),
    ...(caseId ? { case_id: caseId } : {}),
  };

  const docs = await prisma.firstVisitDocument.findMany({
    where,
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      org_id: true,
      patient_id: true,
      case_id: true,
      emergency_contacts: true,
      document_url: true,
      delivered_at: true,
      delivered_to: true,
      created_at: true,
      updated_at: true,
    },
  });

  const hasMore = docs.length > limit;
  const data = hasMore ? docs.slice(0, limit) : docs;
  const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

  return success({ data, hasMore, nextCursor });
}, {
  permission: 'canVisit',
  message: '初回文書の閲覧権限がありません',
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createFirstVisitDocumentSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const doc = await withOrgContext(req.orgId, async (tx) => {
    return tx.firstVisitDocument.create({
      data: {
        org_id: req.orgId,
        patient_id: parsed.data.patient_id,
        case_id: parsed.data.case_id,
        emergency_contacts: parsed.data.emergency_contacts,
        ...(parsed.data.delivered_at
          ? { delivered_at: new Date(parsed.data.delivered_at) }
          : {}),
        delivered_to: parsed.data.delivered_to,
      },
    });
  });

  return success({ data: doc }, 201);
}, {
  permission: 'canVisit',
  message: '初回文書の作成権限がありません',
});
