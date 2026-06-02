import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { notFound, success, validationError } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { createInterventionSchema } from '@/lib/validations/intervention';
import { prisma } from '@/lib/db/client';
import {
  canBypassVisitScheduleAssignmentAccess,
  type VisitScheduleAccessContext,
} from '@/lib/auth/visit-schedule-access';
import { canAccessPatient, listAccessiblePatientIds } from '@/server/services/patient-access';
import type { Prisma } from '@prisma/client';

async function buildInterventionAssignmentWhere(args: {
  orgId: string;
  patientId?: string;
  accessContext: VisitScheduleAccessContext;
}): Promise<Prisma.InterventionWhereInput> {
  if (args.patientId) {
    const canAccess = await canAccessPatient({
      db: prisma,
      orgId: args.orgId,
      patientId: args.patientId,
      accessContext: args.accessContext,
    });

    return canAccess ? { patient_id: args.patientId } : { id: { in: [] } };
  }

  if (canBypassVisitScheduleAssignmentAccess(args.accessContext)) return {};

  const patientIds = await listAccessiblePatientIds({
    db: prisma,
    orgId: args.orgId,
    accessContext: args.accessContext,
  });

  return { patient_id: { in: patientIds } };
}

async function canAttachMedicationIssue(args: {
  orgId: string;
  patientId: string;
  issueId?: string;
}) {
  if (!args.issueId) return true;

  const issue = await prisma.medicationIssue.findFirst({
    where: {
      id: args.issueId,
      org_id: args.orgId,
      patient_id: args.patientId,
    },
    select: { id: true },
  });

  return issue !== null;
}

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);

    const patientId = searchParams.get('patient_id') ?? undefined;
    const issueId = searchParams.get('issue_id') ?? undefined;

    const assignmentWhere = await buildInterventionAssignmentWhere({
      orgId: req.orgId,
      patientId,
      accessContext: req,
    });

    const where = {
      org_id: req.orgId,
      ...(patientId ? { patient_id: patientId } : {}),
      ...(issueId ? { issue_id: issueId } : {}),
      ...assignmentWhere,
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
  },
  {
    permission: 'canVisit',
    message: '介入記録の閲覧権限がありません',
  },
);

export const POST = withAuth(
  async (req: AuthenticatedRequest) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createInterventionSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const canAccessScope = await canAccessPatient({
      db: prisma,
      orgId: req.orgId,
      patientId: parsed.data.patient_id,
      accessContext: req,
    });
    if (!canAccessScope) return notFound('患者が見つかりません');

    if (
      !(await canAttachMedicationIssue({
        orgId: req.orgId,
        patientId: parsed.data.patient_id,
        issueId: parsed.data.issue_id,
      }))
    ) {
      return notFound('服薬課題が見つかりません');
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
  },
  {
    permission: 'canVisit',
    message: '介入記録の作成権限がありません',
  },
);
