import { withAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { notFound, success, validationError } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import {
  createMedicationIssueSchema,
  medicationIssueStatusSchema,
} from '@/lib/validations/medication';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { prisma } from '@/lib/db/client';
import { validateOrgReferences } from '@/lib/api/org-reference';
import {
  canBypassVisitScheduleAssignmentAccess,
  type VisitScheduleAccessContext,
} from '@/lib/auth/visit-schedule-access';
import {
  canAccessCareCase,
  canAccessPatient,
  listAccessibleCareCaseIds,
  listAccessiblePatientIds,
} from '@/server/services/patient-access';
import type { Prisma } from '@prisma/client';

async function buildMedicationIssueAssignmentWhere(args: {
  orgId: string;
  accessContext: VisitScheduleAccessContext;
}): Promise<Prisma.MedicationIssueWhereInput | null> {
  if (canBypassVisitScheduleAssignmentAccess(args.accessContext)) return null;

  const [caseIds, patientIds] = await Promise.all([
    listAccessibleCareCaseIds({
      db: prisma,
      orgId: args.orgId,
      accessContext: args.accessContext,
    }),
    listAccessiblePatientIds({
      db: prisma,
      orgId: args.orgId,
      accessContext: args.accessContext,
    }),
  ]);

  return {
    OR: [
      { case_id: { in: caseIds } },
      { AND: [{ case_id: null }, { patient_id: { in: patientIds } }] },
    ],
  };
}

async function canAccessMedicationIssueScope(args: {
  orgId: string;
  patientId?: string | null;
  caseId?: string | null;
  accessContext: VisitScheduleAccessContext;
}) {
  if (args.caseId) {
    return canAccessCareCase({
      db: prisma,
      orgId: args.orgId,
      caseId: args.caseId,
      patientId: args.patientId ?? undefined,
      accessContext: args.accessContext,
    });
  }

  if (args.patientId) {
    return canAccessPatient({
      db: prisma,
      orgId: args.orgId,
      patientId: args.patientId,
      accessContext: args.accessContext,
    });
  }

  return true;
}

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);

    const patientId = searchParams.get('patient_id') ?? undefined;
    const caseId = searchParams.get('case_id') ?? undefined;
    const statusParam = searchParams.get('status') ?? undefined;
    const status = statusParam ? medicationIssueStatusSchema.safeParse(statusParam) : null;
    if (status && !status.success) {
      return validationError('服薬課題ステータスが不正です', {
        status: ['対応していないステータスです'],
      });
    }

    if (patientId && caseId) {
      const refResult = await validateOrgReferences(ctx.orgId, {
        patient_id: patientId,
        case_id: caseId,
      });
      if (!refResult.ok) return refResult.response;
    }

    const accessContext = { userId: ctx.userId, role: ctx.role };
    if (
      (patientId || caseId) &&
      !(await canAccessMedicationIssueScope({
        orgId: ctx.orgId,
        patientId,
        caseId,
        accessContext,
      }))
    ) {
      return success({ data: [], hasMore: false, nextCursor: undefined });
    }

    const assignmentWhere = await buildMedicationIssueAssignmentWhere({
      orgId: ctx.orgId,
      accessContext,
    });
    const where: Prisma.MedicationIssueWhereInput = {
      org_id: ctx.orgId,
      ...(patientId ? { patient_id: patientId } : {}),
      ...(caseId ? { case_id: caseId } : {}),
      ...(status ? { status: status.data } : {}),
      ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
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
  },
  {
    permission: 'canVisit',
    message: '服薬課題の閲覧権限がありません',
  },
);

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createMedicationIssueSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { patient_id, case_id } = parsed.data;
    const refResult = await validateOrgReferences(ctx.orgId, {
      patient_id,
      case_id,
    });
    if (!refResult.ok) return refResult.response;

    if (
      !(await canAccessMedicationIssueScope({
        orgId: ctx.orgId,
        patientId: patient_id,
        caseId: case_id,
        accessContext: { userId: ctx.userId, role: ctx.role },
      }))
    ) {
      return notFound('患者またはケースが見つかりません');
    }

    const issue = await withOrgContext(ctx.orgId, async (tx) => {
      return tx.medicationIssue.create({
        data: {
          org_id: ctx.orgId,
          identified_by: ctx.userId,
          ...parsed.data,
        },
      });
    });

    return success({ data: issue }, 201);
  },
  {
    permission: 'canVisit',
    message: '服薬課題の作成権限がありません',
  },
);
