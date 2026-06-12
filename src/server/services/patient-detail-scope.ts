import type { MemberRole, Prisma } from '@prisma/client';
import {
  applyPatientAssignmentWhere,
  buildCareCaseAssignmentWhere,
} from '@/lib/auth/visit-schedule-access';

export type PatientDetailScopeArgs = {
  orgId: string;
  patientId: string;
  role: MemberRole;
  userId: string;
};

export function buildPatientDetailWhere(args: PatientDetailScopeArgs): Prisma.PatientWhereInput {
  return applyPatientAssignmentWhere(
    {
      id: args.patientId,
      org_id: args.orgId,
    },
    {
      userId: args.userId,
      role: args.role,
    },
  );
}

export function buildAssignedCareCaseWhere(
  args: Pick<PatientDetailScopeArgs, 'role' | 'userId'>,
  base?: Prisma.CareCaseWhereInput,
): Prisma.CareCaseWhereInput | undefined {
  const assignmentWhere = buildCareCaseAssignmentWhere({
    userId: args.userId,
    role: args.role,
  });
  if (!assignmentWhere) return base;
  if (!base) return assignmentWhere;
  return { AND: [base, assignmentWhere] };
}

export function buildVisitRecordCaseScope(caseIds: string[]): Prisma.VisitRecordWhereInput {
  return {
    schedule: {
      case_id: { in: caseIds },
    },
  };
}

export function buildCareReportCaseScope(caseIds: string[]): Prisma.CareReportWhereInput {
  return {
    OR: [{ case_id: { in: caseIds } }, { case_id: null }],
  };
}

export function buildNullableCaseScope(caseIds: string[]) {
  return {
    OR: [{ case_id: null }, { case_id: { in: caseIds } }],
  };
}
