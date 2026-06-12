import { withAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { notFound, success, validationError } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { createFirstVisitDocumentSchema } from '@/lib/validations/first-visit-document';
import { prisma } from '@/lib/db/client';
import {
  canBypassVisitScheduleAssignmentAccess,
  type VisitScheduleAccessContext,
} from '@/lib/auth/visit-schedule-access';
import {
  canAccessCareCase,
  listAccessibleCareCaseIds,
  listAccessiblePatientCaseIds,
} from '@/server/services/patient-access';
import type { Prisma } from '@prisma/client';

async function buildFirstVisitDocumentAssignmentWhere(args: {
  orgId: string;
  patientId?: string;
  caseId?: string;
  accessContext: VisitScheduleAccessContext;
}): Promise<Prisma.FirstVisitDocumentWhereInput> {
  if (args.caseId) {
    const canAccess = await canAccessCareCase({
      db: prisma,
      orgId: args.orgId,
      caseId: args.caseId,
      patientId: args.patientId,
      accessContext: args.accessContext,
    });

    return canAccess ? { case_id: args.caseId } : { id: { in: [] } };
  }

  if (canBypassVisitScheduleAssignmentAccess(args.accessContext)) return {};

  const caseIds = args.patientId
    ? await listAccessiblePatientCaseIds({
        db: prisma,
        orgId: args.orgId,
        patientId: args.patientId,
        accessContext: args.accessContext,
      })
    : await listAccessibleCareCaseIds({
        db: prisma,
        orgId: args.orgId,
        accessContext: args.accessContext,
      });

  return { case_id: { in: caseIds } };
}

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);

    const patientId = searchParams.get('patient_id') ?? undefined;
    const caseId = searchParams.get('case_id') ?? undefined;

    const assignmentWhere = await buildFirstVisitDocumentAssignmentWhere({
      orgId: ctx.orgId,
      patientId,
      caseId,
      accessContext: ctx,
    });

    const where = {
      org_id: ctx.orgId,
      ...(patientId ? { patient_id: patientId } : {}),
      ...(caseId ? { case_id: caseId } : {}),
      ...assignmentWhere,
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
  },
  {
    permission: 'canVisit',
    message: '初回文書の閲覧権限がありません',
  },
);

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createFirstVisitDocumentSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const canAccessScope = await canAccessCareCase({
      db: prisma,
      orgId: ctx.orgId,
      caseId: parsed.data.case_id,
      patientId: parsed.data.patient_id,
      accessContext: ctx,
    });
    if (!canAccessScope) return notFound('患者またはケースが見つかりません');

    const doc = await withOrgContext(ctx.orgId, async (tx) => {
      return tx.firstVisitDocument.create({
        data: {
          org_id: ctx.orgId,
          patient_id: parsed.data.patient_id,
          case_id: parsed.data.case_id,
          emergency_contacts: parsed.data.emergency_contacts,
          ...(parsed.data.delivered_at ? { delivered_at: new Date(parsed.data.delivered_at) } : {}),
          delivered_to: parsed.data.delivered_to,
        },
      });
    });

    return success({ data: doc }, 201);
  },
  {
    permission: 'canVisit',
    message: '初回文書の作成権限がありません',
  },
);
