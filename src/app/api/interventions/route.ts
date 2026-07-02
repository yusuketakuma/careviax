import { withAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { notFound, success, validationError } from '@/lib/api/response';
import { readStrictOptionalSearchParam } from '@/lib/api/search-params';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { buildCursorPage, parsePaginationParams } from '@/lib/api/pagination';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { createInterventionSchema } from '@/lib/validations/intervention';
import { prisma } from '@/lib/db/client';
import {
  canBypassVisitScheduleAssignmentAccess,
  type VisitScheduleAccessContext,
} from '@/lib/auth/visit-schedule-access';
import { canAccessPatient, listAccessiblePatientIds } from '@/server/services/patient-access';
import type { Prisma } from '@prisma/client';

function parseInterventionListFilters(searchParams: URLSearchParams) {
  const patientResult = readStrictOptionalSearchParam(searchParams, 'patient_id', {
    blank: '患者IDを指定してください',
    invalid: '患者IDの形式が不正です',
  });
  if (!patientResult.ok) {
    return {
      ok: false as const,
      response: withSensitiveNoStore(
        validationError('検索条件が不正です', patientResult.fieldErrors),
      ),
    };
  }

  const issueResult = readStrictOptionalSearchParam(searchParams, 'issue_id', {
    blank: '服薬課題IDを指定してください',
    invalid: '服薬課題IDの形式が不正です',
  });
  if (!issueResult.ok) {
    return {
      ok: false as const,
      response: withSensitiveNoStore(
        validationError('検索条件が不正です', issueResult.fieldErrors),
      ),
    };
  }

  return {
    ok: true as const,
    patientId: patientResult.value,
    issueId: issueResult.value,
  };
}

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

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);
    const filters = parseInterventionListFilters(searchParams);
    if (!filters.ok) return filters.response;

    const { patientId, issueId } = filters;

    const assignmentWhere = await buildInterventionAssignmentWhere({
      orgId: ctx.orgId,
      patientId,
      accessContext: ctx,
    });

    const where = {
      org_id: ctx.orgId,
      ...(patientId ? { patient_id: patientId } : {}),
      ...(issueId ? { issue_id: issueId } : {}),
      ...assignmentWhere,
    };

    const interventions = await prisma.intervention.findMany({
      where,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ performed_at: 'desc' }, { id: 'desc' }],
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

    return withSensitiveNoStore(
      success(buildCursorPage(interventions, limit, (intervention) => intervention.id)),
    );
  },
  {
    permission: 'canVisit',
    message: '介入記録の閲覧権限がありません',
  },
);

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createInterventionSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const canAccessScope = await canAccessPatient({
      db: prisma,
      orgId: ctx.orgId,
      patientId: parsed.data.patient_id,
      accessContext: ctx,
    });
    if (!canAccessScope) return notFound('患者が見つかりません');

    if (
      !(await canAttachMedicationIssue({
        orgId: ctx.orgId,
        patientId: parsed.data.patient_id,
        issueId: parsed.data.issue_id,
      }))
    ) {
      return notFound('服薬課題が見つかりません');
    }

    const intervention = await withOrgContext(ctx.orgId, async (tx) => {
      return tx.intervention.create({
        data: {
          org_id: ctx.orgId,
          performed_by: ctx.userId,
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
