import type { MemberRole, Prisma } from '@prisma/client';

export type VisitScheduleAccessContext = {
  userId: string;
  role: MemberRole;
};

type VisitScheduleAssignmentSubject = {
  pharmacist_id: string | null;
  case_?: {
    primary_pharmacist_id: string | null;
    backup_pharmacist_id: string | null;
  } | null;
};

export function canBypassVisitScheduleAssignmentAccess(
  ctx: Pick<VisitScheduleAccessContext, 'role'>,
) {
  return ctx.role === 'owner' || ctx.role === 'admin';
}

export function canAccessVisitScheduleAssignment(
  ctx: VisitScheduleAccessContext,
  schedule: VisitScheduleAssignmentSubject | null | undefined,
) {
  if (canBypassVisitScheduleAssignmentAccess(ctx)) return true;
  if (!schedule) return false;

  return (
    schedule.pharmacist_id === ctx.userId ||
    schedule.case_?.primary_pharmacist_id === ctx.userId ||
    schedule.case_?.backup_pharmacist_id === ctx.userId
  );
}

export function buildVisitScheduleAssignmentWhere(
  ctx: VisitScheduleAccessContext,
): Prisma.VisitScheduleWhereInput | null {
  if (canBypassVisitScheduleAssignmentAccess(ctx)) return null;

  return {
    OR: [
      { pharmacist_id: ctx.userId },
      { case_: { primary_pharmacist_id: ctx.userId } },
      { case_: { backup_pharmacist_id: ctx.userId } },
    ],
  };
}

export function buildCareCaseAssignmentWhere(
  ctx: VisitScheduleAccessContext,
): Prisma.CareCaseWhereInput | null {
  if (canBypassVisitScheduleAssignmentAccess(ctx)) return null;

  return {
    OR: [
      { primary_pharmacist_id: ctx.userId },
      { backup_pharmacist_id: ctx.userId },
      { visit_schedules: { some: { pharmacist_id: ctx.userId } } },
    ],
  };
}

export function buildVisitScheduleProposalAssignmentWhere(
  ctx: VisitScheduleAccessContext,
): Prisma.VisitScheduleProposalWhereInput | null {
  if (canBypassVisitScheduleAssignmentAccess(ctx)) return null;

  return {
    OR: [
      { proposed_pharmacist_id: ctx.userId },
      { case_: { primary_pharmacist_id: ctx.userId } },
      { case_: { backup_pharmacist_id: ctx.userId } },
      { case_: { visit_schedules: { some: { pharmacist_id: ctx.userId } } } },
    ],
  };
}

export function buildVisitScheduleProposalCaseAccessWhere(
  ctx: VisitScheduleAccessContext,
  proposedPharmacistId?: string | null,
): Prisma.CareCaseWhereInput | null {
  if (canBypassVisitScheduleAssignmentAccess(ctx)) return null;
  if (proposedPharmacistId && proposedPharmacistId === ctx.userId) return null;

  return buildCareCaseAssignmentWhere(ctx);
}

export function buildPatientAssignmentWhere(
  ctx: VisitScheduleAccessContext,
): Prisma.PatientWhereInput | null {
  const caseWhere = buildCareCaseAssignmentWhere(ctx);
  return caseWhere ? { cases: { some: caseWhere } } : null;
}

export function applyPatientAssignmentWhere(
  where: Prisma.PatientWhereInput,
  ctx: VisitScheduleAccessContext,
): Prisma.PatientWhereInput {
  const caseAssignmentWhere = buildCareCaseAssignmentWhere(ctx);
  if (!caseAssignmentWhere) return where;

  const existingCases = where.cases;
  const existingCaseSome =
    existingCases &&
    typeof existingCases === 'object' &&
    'some' in existingCases &&
    existingCases.some
      ? (existingCases.some as Prisma.CareCaseWhereInput)
      : null;

  if (existingCaseSome) {
    return {
      ...where,
      cases: {
        ...(existingCases as Prisma.CareCaseListRelationFilter),
        some: {
          AND: [existingCaseSome, caseAssignmentWhere],
        },
      },
    };
  }

  const existingAnd = where.AND ? (Array.isArray(where.AND) ? where.AND : [where.AND]) : [];

  return {
    ...where,
    AND: [...existingAnd, { cases: { some: caseAssignmentWhere } }],
  };
}

export function buildVisitRecordScheduleAssignmentWhere(
  ctx: VisitScheduleAccessContext,
): Prisma.VisitRecordWhereInput | null {
  const scheduleWhere = buildVisitScheduleAssignmentWhere(ctx);
  return scheduleWhere ? { schedule: scheduleWhere } : null;
}
