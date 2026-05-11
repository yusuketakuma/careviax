import type { MemberRole, Prisma, PrismaClient } from '@prisma/client';
import {
  buildCareCaseAssignmentWhere,
  canAccessVisitScheduleAssignment,
  canBypassVisitScheduleAssignmentAccess,
} from '@/lib/auth/visit-schedule-access';

type DbClient = Pick<PrismaClient, 'careCase' | 'visitRecord'>;

export type CareReportAccessContext = {
  userId: string;
  role: MemberRole;
};

export type CareReportAccessScope = {
  caseIds: string[];
  patientIds: string[];
};

export async function getCareReportAccessScope(
  db: DbClient,
  orgId: string,
  ctx: CareReportAccessContext,
): Promise<CareReportAccessScope | null> {
  const caseAssignmentWhere = buildCareCaseAssignmentWhere(ctx);
  if (!caseAssignmentWhere) return null;

  const cases = await db.careCase.findMany({
    where: {
      org_id: orgId,
      AND: [caseAssignmentWhere],
    },
    select: {
      id: true,
      patient_id: true,
    },
  });

  return {
    caseIds: cases.map((careCase) => careCase.id),
    patientIds: Array.from(new Set(cases.map((careCase) => careCase.patient_id))),
  };
}

export function buildCareReportAccessWhere(
  scope: CareReportAccessScope | null,
): Prisma.CareReportWhereInput | null {
  if (!scope) return null;
  if (scope.caseIds.length === 0 && scope.patientIds.length === 0) {
    return { id: { in: [] } };
  }

  return {
    OR: [
      ...(scope.caseIds.length > 0 ? [{ case_id: { in: scope.caseIds } }] : []),
      ...(scope.patientIds.length > 0
        ? [{ case_id: null, patient_id: { in: scope.patientIds } }]
        : []),
    ],
  };
}

export async function canAccessCareReportSource(
  db: DbClient,
  orgId: string,
  ctx: CareReportAccessContext,
  source: {
    patientId: string;
    caseId?: string | null;
    visitRecordId?: string | null;
  },
) {
  if (canBypassVisitScheduleAssignmentAccess(ctx)) return true;

  if (source.visitRecordId) {
    const visitRecord = await db.visitRecord.findFirst({
      where: {
        id: source.visitRecordId,
        org_id: orgId,
        patient_id: source.patientId,
      },
      select: {
        schedule: {
          select: {
            pharmacist_id: true,
            case_: {
              select: {
                primary_pharmacist_id: true,
                backup_pharmacist_id: true,
              },
            },
          },
        },
      },
    });

    return canAccessVisitScheduleAssignment(ctx, visitRecord?.schedule);
  }

  if (source.caseId) {
    const careCase = await db.careCase.findFirst({
      where: {
        id: source.caseId,
        org_id: orgId,
        patient_id: source.patientId,
      },
      select: {
        primary_pharmacist_id: true,
        backup_pharmacist_id: true,
      },
    });

    return canAccessVisitScheduleAssignment(ctx, {
      pharmacist_id: null,
      case_: careCase,
    });
  }

  const scope = await getCareReportAccessScope(db, orgId, ctx);
  return Boolean(scope?.patientIds.includes(source.patientId));
}
